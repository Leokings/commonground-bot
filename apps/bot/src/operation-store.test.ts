import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryOperationStore } from "./operation-store.js";

describe("MemoryOperationStore", () => {
  afterEach(() => vi.useRealTimers());

  it("persists transaction state and case bindings idempotently", async () => {
    const store = new MemoryOperationStore();
    await store.initialize();
    const now = new Date().toISOString();
    await store.saveOperation({
      transactionHash: "0xabc",
      kind: "open_case",
      guildId: "guild-1",
      caseId: "case-1",
      status: "submitted",
      submittedAt: now,
      updatedAt: now,
    });
    expect(await store.latestCaseOperation("case-1", "open_case")).toMatchObject({ transactionHash: "0xabc", status: "submitted" });
    expect(await store.pendingOperations()).toHaveLength(1);
    await store.updateOperation("0xabc", "finalized");
    expect(await store.pendingOperations()).toHaveLength(0);

    const binding = {
      caseId: "case-1",
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      authorId: "author-1",
      messageHash: "sha256:message",
      ruleId: "respect",
      action: "delete_and_warn",
      finalizedRevision: 0,
    };
    await store.saveCaseBinding(binding);
    await store.saveCaseBinding({ ...binding, action: "changed" });
    expect(await store.getCaseBinding("case-1")).toEqual(binding);

    await store.updateCaseFinalizedState("case-1", 2, "allowed");
    expect(await store.getCaseBinding("case-1")).toMatchObject({
      finalizedRevision: 2,
      finalizedDecision: "allowed",
    });
  });

  it("counts strikes and does not double count one enforcement event", async () => {
    const store = new MemoryOperationStore();
    expect(await store.recordStrike("event-1", "guild", "member", "respect")).toBe(1);
    expect(await store.recordStrike("event-1", "guild", "member", "respect")).toBe(1);
    expect(await store.recordStrike("event-2", "guild", "member", "spam")).toBe(2);
    expect(await store.recordStrike("event-3", "guild", "other", "spam")).toBe(1);
    expect(await store.retractStrike("event-1")).toBe(true);
    expect(await store.retractStrike("event-1")).toBe(false);
  });

  it("rotates retried broadcasts and removes their signed payload after completion", async () => {
    vi.useFakeTimers();
    const store = new MemoryOperationStore();
    const first = { id: "first", raw: "0x01" as const, evmHash: "0x01" as const, kind: "open_case" as const, guildId: "guild" };
    const second = { id: "second", raw: "0x02" as const, evmHash: "0x02" as const, kind: "open_case" as const, guildId: "guild" };
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await store.saveBroadcast(first);
    vi.setSystemTime(new Date("2026-01-01T00:00:01Z"));
    await store.saveBroadcast(second);
    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"));
    await store.touchBroadcast(first.id);

    expect((await store.pendingBroadcasts()).map((item) => item.id)).toEqual(["second", "first"]);
    await store.completeBroadcast(second.id);
    expect((await store.pendingBroadcasts()).map((item) => item.id)).toEqual(["first"]);
  });
});
