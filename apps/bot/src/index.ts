import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";

import { handleInteraction } from "./commands.js";
import { loadConfig } from "./config.js";
import { createContractGateway } from "./contract-gateway.js";
import { loadEnvironment } from "./environment.js";
import { startHealthServer } from "./health-server.js";
import { logger } from "./logger.js";
import { ModerationService } from "./moderation-service.js";
import { createOperationStore } from "./operation-store.js";

loadEnvironment();
const config = loadConfig();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
const gateway = createContractGateway(config);
await gateway.verifyDeployment?.();
const store = createOperationStore(config.databaseUrl);
await store.initialize();
const moderation = new ModerationService(client, config, gateway, store);
const healthServer = await startHealthServer(config.port, () => ({
  ready: client.isReady(),
  network: config.genlayerNetwork,
  contractAddress: config.genlayerContractAddress,
  release: process.env.APP_RELEASE ?? "development",
  ...(config.registryAddress ? { protocol: 2 } : {}),
  ...(config.registryAddress ? { registryAddress: config.registryAddress } : {}),
  ...(config.ledgerAddress ? { ledgerAddress: config.ledgerAddress } : {}),
  ...(gateway.relayerAddress ? { relayerAddress: gateway.relayerAddress } : {}),
}), (caseId) => moderation.publicCase(caseId));
logger.info({ port: config.port }, "health endpoint is listening");

client.once(Events.ClientReady, (readyClient) => {
  logger.info({ user: readyClient.user.tag }, "CommonGround bot is ready");
  void moderation.resumePendingOperations();
});
const recoveryTimer = setInterval(() => {
  if (client.isReady()) void moderation.resumePendingOperations().catch(() => logger.warn("Recovery pass could not complete; queued work is preserved"));
}, 10_000);
recoveryTimer.unref();

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction, moderation).catch(async (error) => {
    logger.error({ error, interactionId: interaction.id }, "interaction failed");
    if (!interaction.isRepliable()) return;
    const content = "CommonGround could not complete that action. The failure was logged.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => undefined);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  });
});

client.on(Events.MessageCreate, (message) => {
  void moderation.handleMessage(message).catch((error) => {
    logger.error(
      { error, guildId: message.guildId, channelId: message.channelId },
      "message moderation failed",
    );
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    logger.info({ signal }, "shutting down CommonGround bot");
    client.destroy();
    clearInterval(recoveryTimer);
    healthServer.close((error) => {
      if (error) logger.error({ error }, "health server shutdown failed");
      process.exitCode = error ? 1 : 0;
    });
  });
}

await client.login(config.discordToken);
