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
const store = createOperationStore(config.databaseUrl);
await store.initialize();
const moderation = new ModerationService(client, config, gateway, store);
const healthServer = await startHealthServer(config.port, () => ({
  ready: client.isReady(),
  network: config.genlayerNetwork,
}));
logger.info({ port: config.port }, "health endpoint is listening");

client.once(Events.ClientReady, (readyClient) => {
  logger.info({ user: readyClient.user.tag }, "CommonGround bot is ready");
  void moderation.resumePendingOperations();
});

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
    healthServer.close((error) => {
      if (error) logger.error({ error }, "health server shutdown failed");
      process.exitCode = error ? 1 : 0;
    });
  });
}

await client.login(config.discordToken);
