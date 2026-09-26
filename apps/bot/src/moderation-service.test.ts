import {
  DEFAULT_RULES,
  hashDiscordIdentifier,
  hashMessageSnapshot,
  type ConstitutionRule,
} from "@commonground/core";
import { ChannelType, Collection, type Client, type Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import type { BotConfig } from "./config.js";
import type {
  ContractCase,
  ContractGateway,
  SubmittedWrite,
} from "./contract-gateway.js";
import {
  ModerationService,
  isPublicReportMessage,
  parseReplyReport,
  selectRuleForReport,
} from "./moderation-service.js";
import { MemoryOperationStore } from "./operation-store.js";

class RecordingGateway implements ContractGateway {
  readonly writes: Array<{ functionName: string; args: unknown[] }> = [];
  rules: ConstitutionRule[] = [];
  caseResponses: ContractCase[] = [];

  async listRules(): Promise<ConstitutionRule[]> {
    return this.rules;
  }

  async getCase(caseId: string): Promise<ContractCase> {
    const queued = this.caseResponses.shift();
    if (queued) return queued;
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
      decision_history: [
        {
          revision: 1,
          kind: "initial",
          decision: "allowed",
          analysis: "Allowed in the test fixture.",
          analysis_provenance: "leader_output_non_authoritative",
          decided_at: "2026-09-24T00:00:00Z",
        },
      ],
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

function connectedTestClient(): Client {
  return {
    user: { id: "bot-1" },
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async () => undefined,
      }),
    },
  } as unknown as Client;
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

function finalizedCase(options: {
  guildId: string;
  decision: "allowed" | "violation" | "needs_context";
  revision: number;
  previousDecision?: "allowed" | "violation" | "needs_context";
}): ContractCase {
  const rule = {
    ...storedRule("no-profanity"),
    guild_key: hashDiscordIdentifier("guild", options.guildId),
    action: "delete_and_strike" as const,
  };
  const firstDecision = options.previousDecision ?? options.decision;
  const history: ContractCase["decision_history"] = [
    {
      revision: 1,
      kind: "initial",
      decision: firstDecision,
      analysis: "Initial validator decision.",
      analysis_provenance: "leader_output_non_authoritative",
      decided_at: "2026-09-24T00:00:00Z",
    },
  ];
  if (options.revision > 1) {
    history.push({
      revision: options.revision,
      kind: "appeal",
      decision: options.decision,
      analysis: "Appeal validator decision.",
      analysis_provenance: "leader_output_non_authoritative",
      appeal_reason: "The original decision should be reconsidered.",
      decided_at: "2026-09-25T00:00:00Z",
    });
  }
  return {
    case_id: "case-appeal-1",
    guild_key: rule.guild_key,
    rule_id: rule.rule_id,
    rule_version: rule.version,
    constitution_version: rule.constitution_version,
    message_hash: hashMessageSnapshot("You are fucking stupid."),
    message_text: "You are fucking stupid.",
    context: "A reply during an argument.",
    challenge_reason: "Community report.",
    author_defense: "",
    decision: options.decision,
    analysis: history.at(-1)?.analysis ?? "",
    status: options.revision > 1 ? "appealed" : "decided",
    decision_revision: options.revision,
    appeal_count: options.revision > 1 ? 1 : 0,
    decision_history: history,
    rule_snapshot: rule,
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

describe("appeal authorization and finalized revision recovery", () => {
  async function seedBinding(
    store: MemoryOperationStore,
    options: { finalizedRevision?: number; finalizedDecision?: "allowed" | "violation" } = {},
  ): Promise<void> {
    await store.saveCaseBinding({
      caseId: "case-appeal-1",
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      authorId: "author-1",
      messageHash: hashMessageSnapshot("You are fucking stupid."),
      ruleId: "no-profanity",
      action: "delete_and_strike",
      finalizedRevision: options.finalizedRevision ?? 1,
      finalizedDecision: options.finalizedDecision ?? "violation",
    });
  }

  function appealClient(send = vi.fn(async () => undefined)): Client {
    return {
      channels: {
        fetch: vi.fn(async () => ({
          isTextBased: () => true,
          send,
        })),
      },
    } as unknown as Client;
  }

  it("rejects an unauthorized appellant before submitting a transaction", async () => {
    const gateway = new RecordingGateway();
    const store = new MemoryOperationStore();
    await seedBinding(store);
    const bot = new ModerationService(appealClient(), config, gateway, store);

    await expect(
      bot.appealCase("guild-1", "case-appeal-1", "Please reconsider.", {
        userId: "unrelated-member",
        canModerate: false,
      }),
    ).rejects.toThrow(/author.*moderator/i);
    expect(gateway.writes).toEqual([]);
  });

  it("rejects a cross-guild appeal before consuming the case appeal", async () => {
    const gateway = new RecordingGateway();
    gateway.caseResponses = [
      finalizedCase({ guildId: "guild-2", decision: "violation", revision: 1 }),
    ];
    const store = new MemoryOperationStore();
    await seedBinding(store);
    const bot = new ModerationService(appealClient(), config, gateway, store);

    await expect(
      bot.appealCase("guild-1", "case-appeal-1", "Please reconsider.", {
        userId: "author-1",
        canModerate: false,
      }),
    ).rejects.toThrow(/does not belong/i);
    expect(gateway.writes).toEqual([]);
    expect(await store.getCaseBinding("case-appeal-1")).toMatchObject({
      finalizedRevision: 1,
      finalizedDecision: "violation",
    });
  });

  it("persists and announces a changed decision on the normal appeal path", async () => {
    const gateway = new RecordingGateway();
    gateway.caseResponses = [
      finalizedCase({ guildId: "guild-1", decision: "violation", revision: 1 }),
      finalizedCase({
        guildId: "guild-1",
        previousDecision: "violation",
        decision: "allowed",
        revision: 2,
      }),
    ];
    const store = new MemoryOperationStore();
    await seedBinding(store);
    await store.recordStrike(
      "case-appeal-1",
      "guild-1",
      "author-1",
      "no-profanity",
    );
    const send = vi.fn(async () => undefined);
    const bot = new ModerationService(appealClient(send), config, gateway, store);

    const result = await bot.appealCase(
      "guild-1",
      "case-appeal-1",
      "The message was quoted role-play.",
      { userId: "author-1", canModerate: false },
    );

    expect(result.case).toMatchObject({ decision: "allowed", decision_revision: 2 });
    expect(gateway.writes.at(-1)).toEqual({
      functionName: "appeal_case",
      args: [
        hashDiscordIdentifier("guild", "guild-1"),
        "case-appeal-1",
        "The message was quoted role-play.",
      ],
    });
    expect(await store.getCaseBinding("case-appeal-1")).toMatchObject({
      finalizedRevision: 2,
      finalizedDecision: "allowed",
    });
    expect(await store.recordStrike("probe", "guild-1", "author-1", "probe")).toBe(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/Appeal revised.*Previous decision.*violation.*allowed.*strike was removed/is),
      }),
    );
  });

  it("fetches and persists a changed appeal revision after a restart", async () => {
    const gateway = new RecordingGateway();
    gateway.caseResponses = [
      finalizedCase({
        guildId: "guild-1",
        previousDecision: "violation",
        decision: "allowed",
        revision: 2,
      }),
    ];
    const store = new MemoryOperationStore();
    await seedBinding(store);
    const now = new Date().toISOString();
    await store.saveOperation({
      transactionHash: "0xappeal",
      kind: "appeal_case",
      guildId: "guild-1",
      caseId: "case-appeal-1",
      status: "submitted",
      submittedAt: now,
      updatedAt: now,
    });
    const send = vi.fn(async () => undefined);
    const bot = new ModerationService(appealClient(send), config, gateway, store);

    await bot.resumePendingOperations();

    expect(await store.pendingOperations()).toHaveLength(0);
    expect(await store.getCaseBinding("case-appeal-1")).toMatchObject({
      finalizedRevision: 2,
      finalizedDecision: "allowed",
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/Appeal revised.*allowed/is) }),
    );
  });

  it("applies enforcement when an appeal changes allowed to violation", async () => {
    const gateway = new RecordingGateway();
    gateway.caseResponses = [
      finalizedCase({ guildId: "guild-1", decision: "allowed", revision: 1 }),
      finalizedCase({
        guildId: "guild-1",
        previousDecision: "allowed",
        decision: "violation",
        revision: 2,
      }),
    ];
    const store = new MemoryOperationStore();
    await seedBinding(store, { finalizedRevision: 1, finalizedDecision: "allowed" });
    const deleteMessage = vi.fn(async () => undefined);
    const send = vi.fn(async () => undefined);
    const sourceMessage = {
      id: "message-1",
      guildId: "guild-1",
      channelId: "channel-1",
      content: "You are fucking stupid.",
      deletable: true,
      delete: deleteMessage,
      author: { id: "author-1", send: vi.fn(async () => undefined) },
    } as unknown as Message;
    const client = {
      channels: {
        fetch: vi.fn(async () => ({
          isTextBased: () => true,
          messages: { fetch: vi.fn(async () => sourceMessage) },
          send,
        })),
      },
    } as unknown as Client;
    const bot = new ModerationService(client, config, gateway, store);

    const result = await bot.appealCase(
      "guild-1",
      "case-appeal-1",
      "The full context shows a direct attack.",
      { userId: "moderator-1", canModerate: true },
    );

    expect(result.case.decision).toBe("violation");
    expect(deleteMessage).toHaveBeenCalledOnce();
    expect(await store.getCaseBinding("case-appeal-1")).toMatchObject({
      finalizedRevision: 2,
      finalizedDecision: "violation",
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/Appeal revised.*violation/is) }),
    );
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

  it("accepts only channels visible to the whole server", () => {
    const base = {
      guildId: "guild-1",
      guild: { roles: { everyone: { id: "guild-1" } } },
      inGuild: () => true,
    };
    const publicMessage = {
      ...base,
      channel: {
        type: ChannelType.GuildText,
        permissionsFor: () => ({ has: () => true }),
      },
    } as unknown as Message;
    const privateMessage = {
      ...base,
      channel: {
        type: ChannelType.PrivateThread,
        permissionsFor: () => ({ has: () => true }),
      },
    } as unknown as Message;
    const hiddenMessage = {
      ...base,
      channel: {
        type: ChannelType.GuildText,
        permissionsFor: () => ({ has: () => false }),
      },
    } as unknown as Message;

    expect(isPublicReportMessage(publicMessage)).toBe(true);
    expect(isPublicReportMessage(privateMessage)).toBe(false);
    expect(isPublicReportMessage(hiddenMessage)).toBe(false);
  });

  it("does not apply the demo guild allowlist to another installed server", async () => {
    const gateway = new RecordingGateway();
    gateway.rules = rules;
    const bot = new ModerationService(
      connectedTestClient(),
      {
        ...config,
        discordTestGuildId: "demo-guild",
        monitoredChannelIds: new Set(["demo-channel"]),
      },
      gateway,
      new MemoryOperationStore(),
    );
    const target = {
      id: "external-message",
      guildId: "external-guild",
      channelId: "external-public-channel",
      guild: { roles: { everyone: { id: "external-guild" } } },
      inGuild: () => true,
      author: { id: "external-member", bot: false },
      content: "You are fucking stupid.",
      createdTimestamp: 1_000,
      mentions: { users: new Collection(), everyone: false },
      channel: {
        type: ChannelType.GuildText,
        permissionsFor: () => ({ has: () => true }),
        messages: {
          fetch: async () => new Collection(),
        },
      },
    } as unknown as Message;

    const result = await bot.reviewReportedMessage(target, "Please review this.");

    expect(result.kind).toBe("submitted");
    expect(gateway.writes.some((write) => write.functionName === "open_case")).toBe(
      true,
    );
  });

  it("always includes the replied-to message and labeled nearby context", async () => {
    const gateway = new RecordingGateway();
    gateway.rules = rules;
    const bot = new ModerationService(
      connectedTestClient(),
      config,
      gateway,
      new MemoryOperationStore(),
    );
    const makeMessage = (
      id: string,
      authorId: string,
      content: string,
      createdTimestamp: number,
      bot = false,
    ) =>
      ({
        id,
        guildId: "guild-1",
        channelId: "channel-1",
        guild: { roles: { everyone: { id: "guild-1" } } },
        inGuild: () => true,
        author: { id: authorId, bot },
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
    const noisyBot = makeMessage(
      "bot-noise-1",
      "another-bot",
      "Unrelated automation result.",
      800,
      true,
    );
    const reportCommand = {
      ...makeMessage("report-1", "member-4", "<@bot-1> report", 1_100),
      mentions: { users: new Collection([["bot-1", {} as never]]), everyone: false },
    } as unknown as Message;
    const target = {
      ...makeMessage("target-1", "member-1", "Fuck, this is so great!", 1_000),
      reference: { messageId: "parent-1" },
      fetchReference: async () => parent,
      channel: {
        type: ChannelType.GuildText,
        permissionsFor: () => ({ has: () => true }),
        messages: {
          fetch: async (options: { before?: string; after?: string }) =>
            options.after
              ? new Collection([
                  [reportCommand.id, reportCommand],
                ])
              : new Collection([
                  [parent.id, parent],
                  [nearby.id, nearby],
                  [noisyBot.id, noisyBot],
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
    expect(openCase?.args[5]).not.toContain("Unrelated automation result");
  });
});
