import type {
  ActivitySnapshot,
  Detector,
  DetectorResult,
  MessageSample,
} from "./types.js";

const HTTP_URL = /\bhttps?:\/\/[^\s<>()]+|\bwww\.[^\s<>()]+/giu;
const DISCORD_INVITE = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/giu;
const MENTION = /<@!?\d+>|@everyone\b|@here\b/giu;
const PICTOGRAPH = /\p{Extended_Pictographic}/gu;
const LETTER = /\p{L}/gu;
const UPPERCASE_LETTER = /\p{Lu}/gu;

const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  "$": "s",
};

function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length;
}

function normalizeForTerms(value: string): string {
  return Array.from(value.normalize("NFKC").toLowerCase())
    .map((character) => LEET_MAP[character] ?? character)
    .join("");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(term: string): RegExp {
  const normalized = normalizeForTerms(term).replace(/[^\p{L}\p{N}]/gu, "");
  if (!normalized) {
    return /$a/u;
  }
  const characters = Array.from(normalized).map(escapeRegExp);
  const body = characters.join("[^\\p{L}\\p{N}]*");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${body}($|[^\\p{L}\\p{N}])`, "iu");
}

function extractDomains(content: string): string[] {
  const matches = content.match(HTTP_URL) ?? [];
  const domains: string[] = [];
  for (const match of matches) {
    try {
      const url = new URL(match.startsWith("www.") ? `https://${match}` : match);
      domains.push(url.hostname.toLowerCase().replace(/^www\./, ""));
    } catch {
      // The regex found URL-like text that URL parsing rejected. It remains a
      // link match but has no normalized domain for allow-listing.
      domains.push("");
    }
  }
  return domains;
}

function domainAllowed(domain: string, allowlist: ReadonlyArray<string>): boolean {
  return allowlist.some((candidate) => {
    const normalized = candidate.toLowerCase().replace(/^www\./, "").replace(/^\./, "");
    return domain === normalized || domain.endsWith(`.${normalized}`);
  });
}

function result(
  detector: Detector["kind"],
  matched: boolean,
  reason: string,
  evidence: DetectorResult["evidence"],
): DetectorResult {
  return {
    detector,
    outcome: matched ? "matched" : "clear",
    reason,
    evidence,
  };
}

export function evaluateDetector(
  detector: Detector,
  message: MessageSample,
  activity: ActivitySnapshot = { authorMessages: [] },
): DetectorResult {
  switch (detector.kind) {
    case "link": {
      const domains = extractDomains(message.content);
      const blocked = domains.filter(
        (domain) => !domain || !domainAllowed(domain, detector.allowed_domains),
      );
      return result(
        detector.kind,
        blocked.length > 0,
        blocked.length > 0
          ? "Message contains a link outside the configured allowlist."
          : "No prohibited link was found.",
        { domains, blockedDomains: blocked },
      );
    }
    case "discord_invite": {
      const count = countMatches(message.content, DISCORD_INVITE);
      return result(
        detector.kind,
        count > 0,
        count > 0 ? "Message contains a Discord invite." : "No Discord invite was found.",
        { count },
      );
    }
    case "profanity": {
      const normalized = normalizeForTerms(message.content);
      const matchedTerms = detector.terms.filter((term) => termPattern(term).test(normalized));
      return result(
        detector.kind,
        matchedTerms.length > 0,
        matchedTerms.length > 0
          ? "Message matched a configured prohibited term."
          : "No configured prohibited term was found.",
        { matchedTerms },
      );
    }
    case "repeated_punctuation": {
      const runs = message.content.match(/[.!?,;:]+/gu) ?? [];
      const maximum = runs.reduce((longest, run) => Math.max(longest, run.length), 0);
      return result(
        detector.kind,
        maximum >= detector.threshold,
        maximum >= detector.threshold
          ? "Message exceeds the repeated-punctuation threshold."
          : "Repeated punctuation is below the configured threshold.",
        { maximumRun: maximum, threshold: detector.threshold },
      );
    }
    case "caps_ratio": {
      const letters = countMatches(message.content, LETTER);
      const uppercase = countMatches(message.content, UPPERCASE_LETTER);
      const ratio = letters === 0 ? 0 : uppercase / letters;
      const matched = letters >= detector.min_letters && ratio >= detector.ratio;
      return result(
        detector.kind,
        matched,
        matched
          ? "Message exceeds the uppercase-letter ratio."
          : "Uppercase usage is below the configured threshold.",
        {
          letters,
          uppercase,
          ratio: Number(ratio.toFixed(4)),
          threshold: detector.ratio,
        },
      );
    }
    case "mention_count": {
      const count = message.mentionCount ?? countMatches(message.content, MENTION);
      return result(
        detector.kind,
        count >= detector.threshold,
        count >= detector.threshold
          ? "Message exceeds the mention threshold."
          : "Mention count is below the configured threshold.",
        { count, threshold: detector.threshold },
      );
    }
    case "emoji_count": {
      const count = countMatches(message.content, PICTOGRAPH);
      return result(
        detector.kind,
        count >= detector.threshold,
        count >= detector.threshold
          ? "Message exceeds the emoji threshold."
          : "Emoji count is below the configured threshold.",
        { count, threshold: detector.threshold },
      );
    }
    case "duplicate_message": {
      const cutoff = message.createdAt - detector.window_seconds * 1_000;
      const normalized = message.content.normalize("NFKC").trim().toLowerCase();
      const duplicates = activity.authorMessages.filter(
        (sample) =>
          sample.createdAt >= cutoff &&
          sample.content.normalize("NFKC").trim().toLowerCase() === normalized,
      ).length + 1;
      return result(
        detector.kind,
        duplicates >= detector.threshold,
        duplicates >= detector.threshold
          ? "Author repeated the same message within the configured window."
          : "Duplicate count is below the configured threshold.",
        {
          count: duplicates,
          threshold: detector.threshold,
          windowSeconds: detector.window_seconds,
        },
      );
    }
    case "message_rate": {
      const cutoff = message.createdAt - detector.window_seconds * 1_000;
      const count = activity.authorMessages.filter(
        (sample) => sample.createdAt >= cutoff,
      ).length + 1;
      return result(
        detector.kind,
        count >= detector.threshold,
        count >= detector.threshold
          ? "Author exceeded the configured message rate."
          : "Message rate is below the configured threshold.",
        {
          count,
          threshold: detector.threshold,
          windowSeconds: detector.window_seconds,
        },
      );
    }
  }
}

