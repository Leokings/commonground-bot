import type { ModerationAction } from "@commonground/core";
import type { Client, Message } from "discord.js";

import type { BotConfig } from "./config.js";
import { logger } from "./logger.js";
import type { OperationStore } from "./operation-store.js";

export class DiscordActionExecutor {
  constructor(
    private readonly client: Client,
    private readonly config: BotConfig,
    private readonly store: OperationStore,
  ) {}

  async execute(
    message: Message,
    action: ModerationAction,
    reason: string,
    caseId?: string,
    ruleId?: string,
  ): Promise<void> {
    const reference = caseId ? ` Case: ${caseId}.` : "";
    if (action === "warn" || action === "delete_and_warn") {
      await message.author
        .send(`CommonGround moderation notice: ${reason}.${reference}`)
        .catch(() => undefined);
    }

    if (
      action === "delete" ||
      action === "delete_and_warn" ||
      action === "delete_and_strike"
    ) {
      if (message.deletable) {
        await message.delete();
      } else {
        throw new Error("The bot cannot delete this message with its current permissions");
      }
    }

    let strikeLine = "";
    if (action === "delete_and_strike") {
      if (!message.guildId || !ruleId) {
        throw new Error("A guild and rule ID are required to record a strike");
      }
      const strikeCount = await this.store.recordStrike(
        caseId ?? `automatic:${message.id}:${ruleId}`,
        message.guildId,
        message.author.id,
        ruleId,
      );
      strikeLine = `\nMember strike count: \`${strikeCount}\``;
    }

    await this.log(
      `**CommonGround enforcement**\n${reason}\nAction: \`${action}\`${
        caseId ? `\nCase: \`${caseId}\`` : ""
      }${strikeLine}`,
      message.channelId,
    );
  }

  async log(content: string, sourceChannelId?: string): Promise<void> {
    const channelId = sourceChannelId ?? this.config.discordModLogChannelId;
    if (!channelId) {
      logger.info({ content }, "moderation log channel is not configured");
      return;
    }
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !("send" in channel)) {
      throw new Error("Moderation log channel is not text based");
    }
    await channel.send({ content });
  }
}
