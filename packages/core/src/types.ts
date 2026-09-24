import { z } from "zod";

export const ruleModeSchema = z.enum(["automatic", "contextual", "hybrid"]);
export type RuleMode = z.infer<typeof ruleModeSchema>;

export const moderationActionSchema = z.enum([
  "warn",
  "delete",
  "delete_and_warn",
  "delete_and_strike",
  "log_only",
]);
export type ModerationAction = z.infer<typeof moderationActionSchema>;

const baseDetectorSchema = z.object({
  on_match: z.enum(["enforce", "review"]).optional(),
});

export const detectorSchema = z.discriminatedUnion("kind", [
  baseDetectorSchema.extend({
    kind: z.literal("link"),
    allowed_domains: z.array(z.string().min(1)).default([]),
  }),
  baseDetectorSchema.extend({
    kind: z.literal("discord_invite"),
  }),
  baseDetectorSchema.extend({
    kind: z.literal("profanity"),
    terms: z.array(z.string().min(1)).min(1),
  }),
  baseDetectorSchema.extend({
    kind: z.literal("repeated_punctuation"),
    threshold: z.number().int().min(2).max(100),
  }),
  baseDetectorSchema.extend({
    kind: z.literal("caps_ratio"),
    ratio: z.number().min(0.1).max(1),
    min_letters: z.number().int().min(1).max(1_000).default(12),
  }),
  baseDetectorSchema.extend({
    kind: z.literal("mention_count"),
    threshold: z.number().int().min(1).max(100),
  }),
  baseDetectorSchema.extend({
    kind: z.literal("emoji_count"),
    threshold: z.number().int().min(1).max(200),
  }),
  baseDetectorSchema.extend({
    kind: z.literal("duplicate_message"),
    threshold: z.number().int().min(2).max(20).default(3),
    window_seconds: z.number().int().min(1).max(3_600).default(30),
  }),
  baseDetectorSchema.extend({
    kind: z.literal("message_rate"),
    threshold: z.number().int().min(2).max(100).default(6),
    window_seconds: z.number().int().min(1).max(3_600).default(10),
  }),
]);

export type Detector = z.infer<typeof detectorSchema>;

export const ruleSchema = z.object({
  guild_key: z.string().min(1),
  rule_id: z.string().min(1),
  version: z.number().int().positive(),
  constitution_version: z.number().int().positive(),
  name: z.string().min(1),
  text: z.string().min(1),
  mode: ruleModeSchema,
  detector_json: z.string(),
  exceptions_json: z.string(),
  scope_json: z.string(),
  action: moderationActionSchema,
  appeal_allowed: z.boolean(),
  active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ConstitutionRule = z.infer<typeof ruleSchema>;

export interface MessageSample {
  id: string;
  guildId: string;
  channelId: string;
  authorId: string;
  content: string;
  createdAt: number;
  mentionCount?: number;
}

export interface ActivitySnapshot {
  authorMessages: ReadonlyArray<MessageSample>;
}

export type DetectorOutcome = "clear" | "matched";
export type RuleOutcome = "allow" | "violation" | "review";

export interface DetectorResult {
  outcome: DetectorOutcome;
  detector: Detector["kind"];
  reason: string;
  evidence: Record<string, string | number | boolean | string[]>;
}

export interface RuleEvaluation {
  outcome: RuleOutcome;
  ruleId: string;
  ruleVersion: number;
  action: ModerationAction;
  detector: DetectorResult | null;
}
