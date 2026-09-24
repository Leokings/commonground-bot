import type { ModerationAction, RuleMode } from "./types.js";

export interface EditableRuleInput {
  ruleId: string;
  name: string;
  text: string;
  mode: RuleMode;
  detectorJson: string;
  exceptionsJson: string;
  scopeJson: string;
  action: ModerationAction;
  appealAllowed: boolean;
}

export const DEFAULT_RULE_PACK_VERSION = 1;

const PUBLIC_SCOPE = JSON.stringify({ channels: ["public"], exclude: ["dm", "private"] });

/**
 * A conservative starter constitution. Deterministic rules act immediately;
 * the profanity rule only uses its word list to find review candidates. The
 * GenLayer decision is based on the complete rule, exceptions, message, and
 * bounded conversation context.
 */
export const DEFAULT_RULES: ReadonlyArray<EditableRuleInput> = [
  {
    ruleId: "no-profanity",
    name: "Context-aware profanity",
    text:
      "Profanity is not automatically a violation. It violates this rule only when the full message and nearby context show that it is directed at a person or group to demean, harass, intimidate, threaten, sexually degrade, or drive them away. Non-targeted emphasis, celebration, frustration about a situation, self-reference, good-faith quotation, educational discussion, and criticism of ideas are allowed unless they independently become targeted abuse.",
    mode: "hybrid",
    detectorJson: JSON.stringify({
      kind: "profanity",
      on_match: "review",
      terms: [
        "fuck",
        "fucking",
        "fucked",
        "motherfucker",
        "motherfuckers",
        "shit",
        "shitty",
        "bullshit",
        "bitch",
        "bitches",
        "asshole",
        "assholes",
        "bastard",
        "bastards",
        "cunt",
        "cunts",
        "dickhead",
        "dickheads",
      ],
    }),
    exceptionsJson: JSON.stringify({
      allow: [
        "non-targeted emphasis or praise, for example: Fuck, this is so great",
        "frustration directed at a situation rather than a person",
        "clearly marked quotation, reporting, education, or moderation evidence",
        "consensual joking when the supplied context clearly establishes it",
      ],
      violation_examples: [
        "a direct personal attack, for example: You are fucking stupid",
        "profane threats, intimidation, sexual degradation, or repeated harassment",
      ],
    }),
    scopeJson: PUBLIC_SCOPE,
    action: "delete_and_warn",
    appealAllowed: true,
  },
  {
    ruleId: "no-targeted-abuse",
    name: "No targeted abuse or harassment",
    text:
      "Messages must not target a person or group with demeaning personal attacks, harassment, intimidation, credible threats, coercion, or attempts to drive them away. Judge communicative meaning in context rather than relying on individual words. Good-faith disagreement, criticism of ideas or conduct, moderation reports, consensual joking, and clearly marked quotations are allowed when they are not themselves abusive.",
    mode: "contextual",
    detectorJson: "{}",
    exceptionsJson: JSON.stringify({
      allow: [
        "good-faith disagreement and criticism of ideas or conduct",
        "moderation reports and clearly marked quotations",
        "consensual joking established by the supplied context",
      ],
    }),
    scopeJson: PUBLIC_SCOPE,
    action: "delete_and_warn",
    appealAllowed: true,
  },
  {
    ruleId: "no-external-invites",
    name: "No unsolicited Discord invites",
    text:
      "Discord invite links are not allowed unless a server administrator has explicitly approved them.",
    mode: "automatic",
    detectorJson: JSON.stringify({ kind: "discord_invite", on_match: "enforce" }),
    exceptionsJson: JSON.stringify({ allow: ["administrator-approved invite links"] }),
    scopeJson: PUBLIC_SCOPE,
    action: "delete_and_warn",
    appealAllowed: false,
  },
  {
    ruleId: "no-message-flooding",
    name: "No message flooding",
    text: "Members must not send six or more messages within ten seconds.",
    mode: "automatic",
    detectorJson: JSON.stringify({
      kind: "message_rate",
      on_match: "enforce",
      threshold: 6,
      window_seconds: 10,
    }),
    exceptionsJson: "{}",
    scopeJson: PUBLIC_SCOPE,
    action: "delete_and_warn",
    appealAllowed: false,
  },
  {
    ruleId: "no-repeated-spam",
    name: "No repeated-message spam",
    text: "Members must not repeat the same message three times within thirty seconds.",
    mode: "automatic",
    detectorJson: JSON.stringify({
      kind: "duplicate_message",
      on_match: "enforce",
      threshold: 3,
      window_seconds: 30,
    }),
    exceptionsJson: "{}",
    scopeJson: PUBLIC_SCOPE,
    action: "delete_and_warn",
    appealAllowed: false,
  },
  {
    ruleId: "no-mass-mentions",
    name: "No mass mentions",
    text: "Messages must not mention five or more members or broadcast groups at once.",
    mode: "automatic",
    detectorJson: JSON.stringify({
      kind: "mention_count",
      on_match: "enforce",
      threshold: 5,
    }),
    exceptionsJson: JSON.stringify({ allow: ["administrator-authorized announcements"] }),
    scopeJson: PUBLIC_SCOPE,
    action: "delete_and_warn",
    appealAllowed: false,
  },
];
