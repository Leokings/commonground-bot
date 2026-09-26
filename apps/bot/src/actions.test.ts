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
});
