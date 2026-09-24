import { describe, expect, it } from "vitest";

import { DEFAULT_RULES } from "./default-rules.js";
import { evaluateRule } from "./rule-engine.js";
import { detectorSchema, type ConstitutionRule, type MessageSample } from "./types.js";

function asStoredRule(index: number): ConstitutionRule {
  const input = DEFAULT_RULES[index];
  if (!input) throw new Error(`Missing default rule at index ${index}`);
  return {
    guild_key: "sha256:guild",
    rule_id: input.ruleId,
    version: 1,
    constitution_version: index + 1,
    name: input.name,
    text: input.text,
    mode: input.mode,
    detector_json: input.detectorJson,
    exceptions_json: input.exceptionsJson,
    scope_json: input.scopeJson,
    action: input.action,
    appeal_allowed: input.appealAllowed,
    active: true,
    created_at: "2026-09-24T00:00:00Z",
    updated_at: "2026-09-24T00:00:00Z",
  };
}

function message(content: string): MessageSample {
  return {
    id: "message-1",
    guildId: "guild-1",
    channelId: "channel-1",
    authorId: "member-1",
    content,
    createdAt: 1_000,
  };
}

describe("default rule pack", () => {
  it("contains unique, parseable rule and detector definitions", () => {
    expect(new Set(DEFAULT_RULES.map((rule) => rule.ruleId)).size).toBe(
      DEFAULT_RULES.length,
    );
    for (const rule of DEFAULT_RULES) {
      expect(() => JSON.parse(rule.exceptionsJson)).not.toThrow();
      expect(() => JSON.parse(rule.scopeJson)).not.toThrow();
      if (rule.mode !== "contextual") {
        expect(() => detectorSchema.parse(JSON.parse(rule.detectorJson))).not.toThrow();
      }
    }
  });

  it("routes both positive and insulting profanity to contextual review", () => {
    const profanity = asStoredRule(0);
    expect(evaluateRule(profanity, message("Fuck, this is so great!"))).toMatchObject({
      outcome: "review",
      ruleId: "no-profanity",
    });
    expect(evaluateRule(profanity, message("You are fucking stupid."))).toMatchObject({
      outcome: "review",
      ruleId: "no-profanity",
    });
  });

  it("does not submit ordinary clean language for contextual profanity review", () => {
    expect(
      evaluateRule(asStoredRule(0), message("Thanks for helping with the release.")),
    ).toMatchObject({ outcome: "allow" });
  });
});
