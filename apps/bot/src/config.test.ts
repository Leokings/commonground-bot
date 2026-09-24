import { describe, expect, it } from "vitest";

import { loadCommandRegistrationConfig, loadConfig } from "./config.js";

const validEnvironment = {
  DISCORD_BOT_TOKEN: "test-token",
  DISCORD_CLIENT_ID: "123456789",
  DISCORD_TEST_GUILD_ID: "987654321",
  DISCORD_MONITORED_CHANNEL_IDS: "111, 222",
  GENLAYER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  GENLAYER_NETWORK: "studionet",
  GENLAYER_CONTRACT_ADDRESS: `0x${"22".repeat(20)}`,
  AUTO_SUBMIT_HYBRID: "true",
};

describe("bot configuration", () => {
  it("parses explicit runtime configuration", () => {
    const config = loadConfig(validEnvironment);
    expect(config.genlayerNetwork).toBe("studionet");
    expect(config.autoSubmitHybrid).toBe(true);
    expect(config.monitoredChannelIds).toEqual(new Set(["111", "222"]));
    expect(config.port).toBe(8080);
  });

  it("accepts a deployment health port", () => {
    const config = loadConfig({ ...validEnvironment, PORT: "3000" });
    expect(config.port).toBe(3000);
  });

  it("rejects malformed private keys", () => {
    expect(() =>
      loadConfig({ ...validEnvironment, GENLAYER_PRIVATE_KEY: "not-a-key" }),
    ).toThrow(/private key/i);
  });

  it("treats blank optional settings as unconfigured", () => {
    const config = loadConfig({
      ...validEnvironment,
      DATABASE_URL: "",
      DISCORD_MOD_LOG_CHANNEL_ID: "",
      GENLAYER_RPC_URL: "",
    });

    expect(config.databaseUrl).toBeUndefined();
    expect(config.discordModLogChannelId).toBeUndefined();
    expect(config.genlayerRpcUrl).toBeUndefined();
  });

  it("registers Discord commands without requiring contract credentials", () => {
    const config = loadCommandRegistrationConfig({
      DISCORD_BOT_TOKEN: "test-token",
      DISCORD_CLIENT_ID: "123456789",
      DISCORD_TEST_GUILD_ID: "987654321",
    });

    expect(config).toEqual({
      discordToken: "test-token",
      discordClientId: "123456789",
      discordTestGuildId: "987654321",
    });
  });
});
