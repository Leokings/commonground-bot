import { z } from "zod";

const privateKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte 0x-prefixed private key");

const optionalDiscordId = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().regex(/^\d+$/).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);

const configSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().regex(/^\d+$/),
  DISCORD_TEST_GUILD_ID: optionalDiscordId,
  DISCORD_MOD_LOG_CHANNEL_ID: optionalDiscordId,
  DISCORD_MONITORED_CHANNEL_IDS: z.string().default(""),
  GENLAYER_PRIVATE_KEY: privateKey,
  GENLAYER_NETWORK: z
    .enum(["localnet", "studionet", "testnet-bradbury"])
    .default("localnet"),
  GENLAYER_CONTRACT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  GENLAYER_RPC_URL: optionalUrl,
  AUTO_SUBMIT_HYBRID: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DATABASE_URL: optionalUrl,
  POSTGRES_URI: optionalUrl,
  NF_COMMONGROUND_DB_POSTGRES_URI: optionalUrl,
  PORT: z.coerce.number().int().min(1).max(65_535).default(8_080),
});

const commandRegistrationConfigSchema = z
  .object({
    DISCORD_BOT_TOKEN: z.string().min(1),
    DISCORD_CLIENT_ID: z.string().regex(/^\d+$/),
    DISCORD_TEST_GUILD_ID: optionalDiscordId,
    DISCORD_COMMAND_SCOPE: z.enum(["global", "guild"]).default("global"),
  })
  .superRefine((value, context) => {
    if (value.DISCORD_COMMAND_SCOPE === "guild" && !value.DISCORD_TEST_GUILD_ID) {
      context.addIssue({
        code: "custom",
        path: ["DISCORD_TEST_GUILD_ID"],
        message: "is required when DISCORD_COMMAND_SCOPE is guild",
      });
    }
  });

export type BotConfig = ReturnType<typeof loadConfig>;
export type CommandRegistrationConfig = ReturnType<
  typeof loadCommandRegistrationConfig
>;

export function loadCommandRegistrationConfig(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const parsed = commandRegistrationConfigSchema.parse(environment);
  return {
    discordToken: parsed.DISCORD_BOT_TOKEN,
    discordClientId: parsed.DISCORD_CLIENT_ID,
    discordTestGuildId: parsed.DISCORD_TEST_GUILD_ID,
    commandScope: parsed.DISCORD_COMMAND_SCOPE,
  };
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = configSchema.parse(environment);
  return {
    discordToken: parsed.DISCORD_BOT_TOKEN,
    discordClientId: parsed.DISCORD_CLIENT_ID,
    discordTestGuildId: parsed.DISCORD_TEST_GUILD_ID,
    discordModLogChannelId: parsed.DISCORD_MOD_LOG_CHANNEL_ID,
    monitoredChannelIds: new Set(
      parsed.DISCORD_MONITORED_CHANNEL_IDS.split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    genlayerPrivateKey: parsed.GENLAYER_PRIVATE_KEY as `0x${string}`,
    genlayerNetwork: parsed.GENLAYER_NETWORK,
    genlayerContractAddress: parsed.GENLAYER_CONTRACT_ADDRESS as `0x${string}`,
    genlayerRpcUrl: parsed.GENLAYER_RPC_URL,
    autoSubmitHybrid: parsed.AUTO_SUBMIT_HYBRID,
    databaseUrl:
      parsed.DATABASE_URL ??
      parsed.POSTGRES_URI ??
      parsed.NF_COMMONGROUND_DB_POSTGRES_URI,
    port: parsed.PORT,
  };
}
