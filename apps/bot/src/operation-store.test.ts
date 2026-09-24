import { describe, expect, it } from "vitest";

import { MemoryOperationStore } from "./operation-store.js";

describe("MemoryOperationStore", () => {
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
    };
    await store.saveCaseBinding(binding);
    await store.saveCaseBinding({ ...binding, action: "changed" });
    expect(await store.getCaseBinding("case-1")).toEqual(binding);
  });

  it("counts strikes and does not double count one enforcement event", async () => {
    const store = new MemoryOperationStore();
    expect(await store.recordStrike("event-1", "guild", "member", "respect")).toBe(1);
    expect(await store.recordStrike("event-1", "guild", "member", "respect")).toBe(1);
    expect(await store.recordStrike("event-2", "guild", "member", "spam")).toBe(2);
    expect(await store.recordStrike("event-3", "guild", "other", "spam")).toBe(1);
  });
});

