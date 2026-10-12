import { DEFAULT_RULES, hashDiscordIdentifier, hashExactText, type ConstitutionRule } from "@commonground/core";
import type { Client, Message } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotConfig } from "./config.js";
import type { ContractCase, ContractGateway } from "./contract-gateway.js";
import { ModerationService } from "./moderation-service.js";
import { MemoryOperationStore, type CaseWorkflow } from "./operation-store.js";

const caseId = `case-${"a".repeat(64)}`;
const guildKey = hashDiscordIdentifier("guild", "guild-1");
const input = DEFAULT_RULES.find((rule) => rule.ruleId === "no-profanity")!;
const rule: ConstitutionRule = {
  guild_key: guildKey, rule_id: input.ruleId, version: 1, constitution_version: 1,
  name: input.name, text: input.text, mode: input.mode, detector_json: input.detectorJson,
  exceptions_json: input.exceptionsJson, scope_json: input.scopeJson, action: "delete_and_strike",
  appeal_allowed: true, active: true, created_at: "2026-10-12T00:00:00Z", updated_at: "2026-10-12T00:00:00Z",
};
const config = { genlayerNetwork: "studionet", monitoredChannelIds: new Set<string>() } as BotConfig;

async function fixture(stage: CaseWorkflow["stage"] = "waiting_defense") {
  const now = Math.floor(Date.now() / 1000);
  const item: ContractCase = {
    case_id: caseId, guild_key: guildKey, rule_id: rule.rule_id, rule_version: 1,
    constitution_version: 1, message_hash: hashExactText("exact message"), message_text: "exact message",
    context: "", challenge_reason: "Member report", author_defense: "", decision: "pending", analysis: "",
    status: "awaiting_defense", decision_revision: 0, appeal_count: 0, decision_history: [], rule_snapshot: rule,
    defense_deadline: now + 120, context_deadline: now + 86_400, appeal_deadline: 0, enforce_after: 0,
  };
  const write = vi.fn(async (functionName: string, args: unknown[]) => ({
    hash: `0x${write.mock.calls.length.toString(16).padStart(64, "0")}`, functionName,
  }));
  const eligible = { eligible: false };
  const gateway: ContractGateway = {
    protocol: 2, listRules: vi.fn(async () => [rule]), getCase: vi.fn(async () => structuredClone(item)),
    write, waitForSuccess: vi.fn(async () => undefined), isFinalizedSuccess: vi.fn(async () => true),
    readPublic: vi.fn(async (_method, _args, target) => target === "ledger" ? {} : eligible),
  };
  const store = new MemoryOperationStore();
  await store.claimCase({ caseId, guildId: "guild-1", channelId: "channel-1", messageId: "message-1",
    authorId: "author-1", messageHash: item.message_hash, ruleId: rule.rule_id, action: rule.action,
    finalizedRevision: 0, workflow: { stage, args: [] } });
  const deleteMessage = vi.fn(async () => undefined);
  const send = vi.fn(async () => undefined);
  const message = { content: item.message_text, deletable: true, delete: deleteMessage,
    id: "message-1", guildId: "guild-1", channelId: "channel-1", author: { id: "author-1", send },
    channel: {} } as unknown as Message;
  const client = { channels: { fetch: vi.fn(async () => ({
    isTextBased: () => true, messages: { fetch: vi.fn(async () => message) }, send,
  })) }} as unknown as Client;
  const bot = new ModerationService(client, config, gateway, store);
  const decide = (decision: "allowed" | "violation") => {
    item.status = "decided"; item.decision = decision; item.decision_revision = 1;
    item.decision_history = [{ revision: 1, kind: "initial", decision, analysis: "Validator result",
      analysis_provenance: "leader_output_non_authoritative", decided_at: new Date().toISOString() }];
  };
  return { bot, gateway, store, item, write, eligible, deleteMessage, message, send, decide };
}

describe("v2 durable moderation workflow", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["awaiting_defense", "context_supplied", "awaiting_context"])("expires %s after downtime without attempting a late adjudication", async (status) => {
    const f = await fixture();
    f.item.status = status; f.item.context_deadline = Math.floor(Date.now() / 1000) - 1;
    await f.bot.resumePendingOperations();
    expect(f.write).toHaveBeenCalledWith("expire_case", [caseId], expect.any(Function));
    expect(f.deleteMessage).not.toHaveBeenCalled();
  });

  it("closes an expired unreviewed case without inventing a decision or a ledger receipt", async () => {
    const f = await fixture("waiting_context");
    f.item.status = "closed_unresolved";
    await f.bot.resumePendingOperations();
    expect((await f.store.getCaseBinding(caseId))?.workflow?.stage).toBe("complete");
    expect(f.write).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("without a decision") }));
  });

  it.each(["opening", "reviewing"] as const)("recovers a crash in %s before any signature was persisted", async (stage) => {
    const f = await fixture(stage);
    await f.bot.resumePendingOperations();
    expect((await f.store.getCaseBinding(caseId))?.workflow?.stage).toBe(stage === "opening" ? "queued" : "waiting_defense");
    expect(f.write).not.toHaveBeenCalled();
  });

  it("preserves an ambiguous signed broadcast without replacing it", async () => {
    const f = await fixture("opening");
    await f.store.saveBroadcast({ id: "signed", raw: "0x01", evmHash: "0x02", kind: "open_case", guildId: "guild-1", caseId });
    await f.bot.resumePendingOperations();
    expect((await f.store.getCaseBinding(caseId))?.workflow?.stage).toBe("opening");
    expect(await f.store.pendingBroadcasts()).toHaveLength(1);
    expect(f.write).not.toHaveBeenCalled();
  });

  it("waits for the defense window and a pending transaction before doing more work", async () => {
    const f = await fixture();
    await f.bot.resumePendingOperations();
    expect(f.write).not.toHaveBeenCalled();
    const now = new Date().toISOString();
    await f.store.saveOperation({ kind: "submit_defense", guildId: "guild-1", caseId,
      transactionHash: "0xpending", status: "submitted", submittedAt: now, updatedAt: now });
    vi.mocked(f.gateway.isFinalizedSuccess!).mockResolvedValue(false);
    f.item.defense_deadline = 1;
    await f.bot.resumePendingOperations();
    expect(f.write).not.toHaveBeenCalled();
  });

  it("waits for appeal eligibility and then records truthful execution without repeating it", async () => {
    const f = await fixture("waiting_appeal");
    f.decide("violation");
    await f.bot.resumePendingOperations();
    expect(f.deleteMessage).not.toHaveBeenCalled();
    f.eligible.eligible = true;
    await f.bot.resumePendingOperations();
    expect(f.deleteMessage).toHaveBeenCalledOnce();
    expect(f.write).toHaveBeenCalledWith("record_enforcement", expect.arrayContaining([guildKey, caseId, 1, "applied"]), expect.any(Function));
    expect((await f.store.getCaseBinding(caseId))?.workflow?.stage).toBe("complete");
    await f.bot.resumePendingOperations();
    expect(f.deleteMessage).toHaveBeenCalledOnce();
  });

  it("withholds deletion when the current message no longer matches the exact evidence hash", async () => {
    const f = await fixture("waiting_appeal");
    f.decide("violation"); f.eligible.eligible = true;
    f.message.content = "edited message";
    await f.bot.resumePendingOperations();
    expect(f.deleteMessage).not.toHaveBeenCalled();
    expect((await f.store.getCaseBinding(caseId))?.workflow?.actionOutcome).toBe("withheld_changed");
  });

  it("does not execute an action after the recovery lease passes to another worker", async () => {
    const f = await fixture("waiting_appeal");
    f.decide("violation"); f.eligible.eligible = true;
    vi.spyOn(f.store, "acquireLease").mockResolvedValueOnce(true).mockResolvedValue(false);
    await f.bot.resumePendingOperations();
    expect(f.deleteMessage).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });

  it("reports an interrupted action as unknown after restart instead of repeating deletion", async () => {
    const f = await fixture("executing");
    f.decide("violation"); f.eligible.eligible = true;
    await f.store.updateWorkflow(caseId, { stage: "executing", args: [], actionRevision: 1, actionStarted: true });
    await f.bot.resumePendingOperations();
    expect(f.deleteMessage).not.toHaveBeenCalled();
    expect((await f.store.getCaseBinding(caseId))?.workflow?.actionOutcome).toBe("unknown");
  });

  it("rejects oversized exact messages before saving or signing a new case", async () => {
    const f = await fixture();
    f.message.content = "😀".repeat(1_001);
    await expect(f.bot.openAndAdjudicateCase(f.message, rule.rule_id, rule.action, "Public report")).rejects.toThrow("4000 UTF-8 bytes");
    expect(f.write).not.toHaveBeenCalled();
    expect(await f.store.pendingCases()).toHaveLength(1);
  });
});
