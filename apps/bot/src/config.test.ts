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

  it("uses the Northflank PostgreSQL connection variable", () => {
    const config = loadConfig({
      ...validEnvironment,
      DATABASE_URL: "",
      POSTGRES_URI: "postgresql://bot:secret@database.internal:5432/app",
    });

    expect(config.databaseUrl).toBe(
      "postgresql://bot:secret@database.internal:5432/app",
    );
  });

  it("uses Northflank's linked-addon alias", () => {
    const config = loadConfig({
      ...validEnvironment,
      DATABASE_URL: "",
      NF_COMMONGROUND_DB_POSTGRES_URI:
        "postgresql://bot:secret@northflank.internal:5432/app",
    });

    expect(config.databaseUrl).toBe(
      "postgresql://bot:secret@northflank.internal:5432/app",
    );
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
      commandScope: "global",
    });
  });

  it("supports an explicit test-guild registration scope", () => {
    const config = loadCommandRegistrationConfig({
      DISCORD_BOT_TOKEN: "test-token",
      DISCORD_CLIENT_ID: "123456789",
      DISCORD_TEST_GUILD_ID: "987654321",
      DISCORD_COMMAND_SCOPE: "guild",
    });

    expect(config.commandScope).toBe("guild");
    expect(config.discordTestGuildId).toBe("987654321");
  });

  it("does not require a test guild for global registration or runtime", () => {
    const registration = loadCommandRegistrationConfig({
      DISCORD_BOT_TOKEN: "test-token",
      DISCORD_CLIENT_ID: "123456789",
    });
    const runtime = loadConfig({
      ...validEnvironment,
      DISCORD_TEST_GUILD_ID: "",
    });

    expect(registration.commandScope).toBe("global");
    expect(registration.discordTestGuildId).toBeUndefined();
    expect(runtime.discordTestGuildId).toBeUndefined();
  });

  it("requires a test guild when guild-only registration is selected", () => {
    expect(() =>
      loadCommandRegistrationConfig({
        DISCORD_BOT_TOKEN: "test-token",
        DISCORD_CLIENT_ID: "123456789",
        DISCORD_COMMAND_SCOPE: "guild",
      }),
    ).toThrow(/DISCORD_TEST_GUILD_ID|test guild/i);
  });
});
