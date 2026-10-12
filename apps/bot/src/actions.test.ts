import type { Client, Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { DiscordActionExecutor } from "./actions.js";
import type { BotConfig } from "./config.js";
import { MemoryOperationStore } from "./operation-store.js";

const config = {
  discordToken: "test",
  discordClientId: "1",
  discordTestGuildId: "demo-guild",
  discordModLogChannelId: "demo-log",
  monitoredChannelIds: new Set<string>(),
  genlayerPrivateKey: `0x${"11".repeat(32)}`,
  genlayerNetwork: "studionet",
  genlayerContractAddress: `0x${"22".repeat(20)}`,
  autoSubmitHybrid: true,
  port: 8_080,
} as BotConfig;

describe("Discord action audit delivery", () => {
  it("posts enforcement evidence beside the source message, not in another guild's configured channel", async () => {
    const send = vi.fn(async () => undefined);
    const fetch = vi.fn(async (channelId: string) => ({
      id: channelId,
      isTextBased: () => true,
      send,
    }));
    const executor = new DiscordActionExecutor(
      { channels: { fetch } } as unknown as Client,
      config,
      new MemoryOperationStore(),
    );
    const message = {
      id: "message-1",
      guildId: "external-guild",
      channelId: "external-public-channel",
      author: { id: "member-1", send: vi.fn() },
      deletable: false,
    } as unknown as Message;

    await executor.execute(message, "log_only", "Finalized test decision");

    expect(fetch).toHaveBeenCalledWith("external-public-channel");
    expect(fetch).not.toHaveBeenCalledWith("demo-log");
    expect(send).toHaveBeenCalledOnce();
  });

  it("uses the configured log channel for operations without a source binding", async () => {
    const send = vi.fn(async () => undefined);
    const fetch = vi.fn(async () => ({
      isTextBased: () => true,
      send,
    }));
    const executor = new DiscordActionExecutor(
      { channels: { fetch } } as unknown as Client,
      config,
      new MemoryOperationStore(),
    );

    await executor.log("Background operation finalized");

    expect(fetch).toHaveBeenCalledWith("demo-log");
    expect(send).toHaveBeenCalledOnce();
  });

  it("validates strike metadata before deleting a message", async () => {
    const remove = vi.fn(async () => undefined);
    const executor = new DiscordActionExecutor(
      { channels: { fetch: vi.fn() } } as unknown as Client,
      config,
      new MemoryOperationStore(),
    );
    const message = {
      id: "message-1",
      guildId: "guild-1",
      channelId: "channel-1",
      author: { id: "member-1", send: vi.fn() },
      deletable: true,
      delete: remove,
    } as unknown as Message;

    await expect(executor.execute(message, "delete_and_strike", "test"))
      .rejects.toThrow("A guild and rule ID are required");
    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps the Discord audit log when strike persistence fails after deletion", async () => {
    const send = vi.fn(async () => undefined);
    const fetch = vi.fn(async () => ({ isTextBased: () => true, send }));
    const store = new MemoryOperationStore();
    vi.spyOn(store, "recordStrike").mockRejectedValue(new Error("database unavailable"));
    const executor = new DiscordActionExecutor(
      { channels: { fetch } } as unknown as Client,
      config,
      store,
    );
    const message = {
      id: "message-1",
      guildId: "guild-1",
      channelId: "source-channel",
      author: { id: "member-1", send: vi.fn() },
      deletable: true,
      delete: vi.fn(async () => undefined),
    } as unknown as Message;

    const receipt = await executor.execute(
      message,
      "delete_and_strike",
      "test decision",
      "case-1",
      "respect",
    );

    expect(receipt).toMatchObject({ outcome: "partial", detail: "message deleted but strike could not be persisted" });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ allowedMentions: { parse: [] } });
    expect(send.mock.calls[0]?.[0].content).toContain("message deleted but strike could not be persisted");
  });
});
