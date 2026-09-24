import { describe, expect, it } from "vitest";

import { ActivityTracker } from "./activity.js";
import { evaluateRule } from "./rule-engine.js";
import type { ConstitutionRule, MessageSample } from "./types.js";

function rule(
  detector: Record<string, unknown>,
  mode: ConstitutionRule["mode"] = "automatic",
): ConstitutionRule {
  return {
    guild_key: "sha256:guild",
    rule_id: "test-rule",
    version: 1,
    constitution_version: 1,
    name: "Test rule",
    text: "Test rule text",
    mode,
    detector_json: JSON.stringify(detector),
    exceptions_json: "{}",
    scope_json: "{}",
    action: "delete_and_warn",
    appeal_allowed: true,
    active: true,
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:00Z",
  };
}

function message(content: string, createdAt = 1_000_000): MessageSample {
  return {
    id: "m1",
    guildId: "g1",
    channelId: "c1",
    authorId: "u1",
    content,
    createdAt,
  };
}

describe("deterministic moderation", () => {
  it("blocks external links but permits allowlisted subdomains", () => {
    const config = rule({ kind: "link", allowed_domains: ["genlayer.com"] });
    expect(evaluateRule(config, message("See https://spam.example/a")).outcome).toBe(
      "violation",
    );
    expect(
      evaluateRule(config, message("See https://docs.genlayer.com/guide")).outcome,
    ).toBe("allow");
  });

  it("recognizes Discord invites", () => {
    const config = rule({ kind: "discord_invite" });
    expect(evaluateRule(config, message("join discord.gg/example")).outcome).toBe(
      "violation",
    );
  });

  it("detects separated and leetspeak profanity without substring false positives", () => {
    const config = rule({ kind: "profanity", terms: ["fuck", "ass", "shit"] });
    expect(evaluateRule(config, message("what the f.u.c.k")).outcome).toBe(
      "violation",
    );
    expect(evaluateRule(config, message("that is $h1t")).outcome).toBe(
      "violation",
    );
    expect(evaluateRule(config, message("class assignment")).outcome).toBe("allow");
  });

  it("routes hybrid detector hits to review", () => {
    const config = rule(
      { kind: "profanity", terms: ["fuck", "fucking"] },
      "hybrid",
    );
    expect(
      evaluateRule(config, message("This is a fucking brilliant release.")),
    ).toMatchObject({ outcome: "review", action: "delete_and_warn" });
  });

  it("enforces punctuation, capitals, mentions, and emoji thresholds", () => {
    expect(
      evaluateRule(
        rule({ kind: "repeated_punctuation", threshold: 12 }),
        message("WHAT????????????"),
      ).outcome,
    ).toBe("violation");
    expect(
      evaluateRule(
        rule({ kind: "caps_ratio", ratio: 0.8, min_letters: 10 }),
        message("THIS MESSAGE IS SHOUTING"),
      ).outcome,
    ).toBe("violation");
    expect(
      evaluateRule(
        rule({ kind: "mention_count", threshold: 3 }),
        message("<@123> <@456> <@789>"),
      ).outcome,
    ).toBe("violation");
    expect(
      evaluateRule(
        rule({ kind: "emoji_count", threshold: 3 }),
        message("🔥🔥🔥"),
      ).outcome,
    ).toBe("violation");
  });

  it("detects duplicate messages and rate bursts with an activity snapshot", () => {
    const tracker = new ActivityTracker();
    tracker.record(message("buy now", 990_000));
    tracker.record({ ...message("buy now", 995_000), id: "m2" });
    const current = { ...message("buy now", 1_000_000), id: "m3" };
    const snapshot = tracker.snapshot(current);

    expect(
      evaluateRule(
        rule({
          kind: "duplicate_message",
          threshold: 3,
          window_seconds: 30,
        }),
        current,
        snapshot,
      ).outcome,
    ).toBe("violation");
    expect(
      evaluateRule(
        rule({ kind: "message_rate", threshold: 3, window_seconds: 30 }),
        current,
        snapshot,
      ).outcome,
    ).toBe("violation");
  });
});
