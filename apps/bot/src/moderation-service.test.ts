import { DEFAULT_RULES, type ConstitutionRule } from "@commonground/core";
import { Collection, type Client, type Message } from "discord.js";
import { describe, expect, it } from "vitest";

import type { BotConfig } from "./config.js";
import type {
  ContractCase,
  ContractGateway,
  SubmittedWrite,
} from "./contract-gateway.js";
import {
  ModerationService,
  parseReplyReport,
  selectRuleForReport,
} from "./moderation-service.js";
import { MemoryOperationStore } from "./operation-store.js";

class RecordingGateway implements ContractGateway {
  readonly writes: Array<{ functionName: string; args: unknown[] }> = [];
  rules: ConstitutionRule[] = [];

  async listRules(): Promise<ConstitutionRule[]> {
    return this.rules;
  }

  async getCase(caseId: string): Promise<ContractCase> {
    const opened = this.writes.find((write) => write.functionName === "open_case");
    const ruleId = String(opened?.args[2] ?? "no-targeted-abuse");
    const rule = this.rules.find((item) => item.rule_id === ruleId) ?? storedRule(ruleId);
    return {
      case_id: caseId,
      guild_key: String(opened?.args[1] ?? "sha256:guild"),
      rule_id: rule.rule_id,
      rule_version: rule.version,
      constitution_version: rule.constitution_version,
      message_hash: String(opened?.args[3] ?? "sha256:message"),
      message_text: String(opened?.args[4] ?? "message"),
      context: String(opened?.args[5] ?? ""),
      challenge_reason: String(opened?.args[6] ?? "report"),
      author_defense: "",
      decision: "allowed",
      analysis: "Allowed in the test fixture.",
      status: "decided",
      decision_revision: 1,
      appeal_count: 0,
      rule_snapshot: rule,
    };
  }

  async write(functionName: string, args: unknown[]): Promise<SubmittedWrite> {
    this.writes.push({ functionName, args });
    return {
      hash: `0x${String(this.writes.length).padStart(64, "0")}`,
      functionName,
    };
  }

  async waitForSuccess(): Promise<void> {}
}

const config = {
  discordToken: "test",
  discordClientId: "1",
  discordTestGuildId: "2",
  monitoredChannelIds: new Set<string>(),
  genlayerPrivateKey: `0x${"11".repeat(32)}`,
  genlayerNetwork: "studionet",
  genlayerContractAddress: `0x${"22".repeat(20)}`,
  autoSubmitHybrid: true,
  port: 8_080,
} as BotConfig;

function service(gateway: RecordingGateway): ModerationService {
  return new ModerationService(
    {} as Client,
    config,
    gateway,
    new MemoryOperationStore(),
  );
}

function storedRule(ruleId: string): ConstitutionRule {
  const input = DEFAULT_RULES.find((rule) => rule.ruleId === ruleId);
  if (!input) throw new Error(`Unknown starter rule ${ruleId}`);
  return {
    guild_key: "sha256:guild",
    rule_id: input.ruleId,
    version: 1,
    constitution_version: 1,
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

describe("starter rule installation", () => {
  it("installs every missing default sequentially", async () => {
    const gateway = new RecordingGateway();
    const result = await service(gateway).installDefaultRules("guild-1", false);

    expect(result.added).toEqual(DEFAULT_RULES.map((rule) => rule.ruleId));
    expect(result.updated).toEqual([]);
    expect(result.transactionHashes).toHaveLength(DEFAULT_RULES.length);
    expect(gateway.writes.map((write) => write.functionName)).toEqual(
      DEFAULT_RULES.map(() => "add_rule"),
    );
  });

  it("preserves customized rules unless replacement is requested", async () => {
    const gateway = new RecordingGateway();
    gateway.rules = [storedRule("no-profanity")];

    const preserved = await service(gateway).installDefaultRules("guild-1", false);
    expect(preserved.skipped).toContain("no-profanity");
    expect(gateway.writes.some((write) => write.functionName === "update_rule")).toBe(
      false,
    );

    gateway.writes.length = 0;
    const replaced = await service(gateway).installDefaultRules("guild-1", true);
    expect(replaced.updated).toContain("no-profanity");
    expect(gateway.writes[0]?.functionName).toBe("update_rule");
  });
});

describe("member-driven reports", () => {
  const sample = (content: string) => ({
    id: "message-1",
    guildId: "guild-1",
    channelId: "channel-1",
    authorId: "member-1",
    content,
    createdAt: 1_000,
    mentionCount: 0,
  });
  const rules = DEFAULT_RULES.map((rule) => storedRule(rule.ruleId));

  it("recognizes a reply-and-mention report with an optional reason", () => {
    expect(parseReplyReport("<@123> report", "123")).toEqual({ reason: "" });
    expect(parseReplyReport("please review this: targeted insult", "123")).toEqual({
      reason: "targeted insult",
    });
    expect(parseReplyReport("hello <@123>", "123")).toBeNull();
  });

  it("selects the profanity rule for a reported profanity candidate", () => {
    const selected = selectRuleForReport(rules, sample("You are fucking stupid."));
    expect(selected?.kind).toBe("review");
    expect(selected?.rule.rule_id).toBe("no-profanity");
  });

  it("falls back to the contextual abuse rule without asking the member for an ID", () => {
    const selected = selectRuleForReport(
      rules,
      sample("Nobody wants you here; leave this server."),
    );
    expect(selected?.kind).toBe("review");
    expect(selected?.rule.rule_id).toBe("no-targeted-abuse");
  });

  it("selects deterministic enforcement for a reported Discord invite", () => {
    const selected = selectRuleForReport(
      rules,
      sample("Join us at https://discord.gg/example"),
    );
    expect(selected?.kind).toBe("enforce");
    expect(selected?.rule.rule_id).toBe("no-external-invites");
  });

  it("ignores every ordinary unreported message", async () => {
    const gateway = new RecordingGateway();
    const bot = new ModerationService(
      { user: { id: "bot-1" } } as Client,
      config,
      gateway,
      new MemoryOperationStore(),
    );
    await bot.handleMessage({
      guildId: "guild-1",
      channelId: "channel-1",
      author: { id: "member-1", bot: false },
      content: "You are fucking stupid.",
      mentions: { users: { has: () => false } },
    } as never);
    expect(gateway.writes).toEqual([]);
  });

  it("always includes the replied-to message and labeled nearby context", async () => {
    const gateway = new RecordingGateway();
    gateway.rules = rules;
    const bot = new ModerationService(
      { user: { id: "bot-1" } } as Client,
      config,
      gateway,
      new MemoryOperationStore(),
    );
    const makeMessage = (
      id: string,
      authorId: string,
      content: string,
      createdTimestamp: number,
    ) =>
      ({
        id,
        guildId: "guild-1",
        channelId: "channel-1",
        author: { id: authorId, bot: false },
        content,
        createdTimestamp,
        mentions: { users: new Collection(), everyone: false },
      }) as unknown as Message;
    const parent = makeMessage(
      "parent-1",
      "member-2",
      "I finally shipped the feature.",
      500,
    );
    const nearby = makeMessage("nearby-1", "member-3", "Nice work!", 700);
    const reportCommand = {
      ...makeMessage("report-1", "member-4", "<@bot-1> report", 1_100),
      mentions: { users: new Collection([["bot-1", {} as never]]), everyone: false },
    } as unknown as Message;
    const target = {
      ...makeMessage("target-1", "member-1", "Fuck, this is so great!", 1_000),
      reference: { messageId: "parent-1" },
      fetchReference: async () => parent,
      channel: {
        messages: {
          fetch: async (options: { before?: string; after?: string }) =>
            options.after
              ? new Collection([
                  [reportCommand.id, reportCommand],
                ])
              : new Collection([
                  [parent.id, parent],
                  [nearby.id, nearby],
                ]),
        },
      },
    } as unknown as Message;

    await bot.reviewReportedMessage(target, "Please review the tone.");

    const openCase = gateway.writes.find((write) => write.functionName === "open_case");
    expect(openCase?.args[4]).toBe("Fuck, this is so great!");
    expect(openCase?.args[5]).toContain(
      "replied-to [member-1]: I finally shipped the feature.",
    );
    expect(openCase?.args[5]).toContain("before [member-2]: Nice work!");
    expect(openCase?.args[5]).not.toContain("<@bot-1> report");
  });
});
