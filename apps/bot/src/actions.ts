import type { ModerationAction } from "@commonground/core";
import type { Client, Message } from "discord.js";

import type { BotConfig } from "./config.js";
import { logger } from "./logger.js";
import type { OperationStore } from "./operation-store.js";

export interface ActionReceipt {
  outcome: "applied" | "partial" | "failed";
  detail: string;
}

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
  ): Promise<ActionReceipt> {
    if (action === "delete_and_strike" && (!message.guildId || !ruleId)) {
      throw new Error("A guild and rule ID are required to record a strike");
    }
    const reference = caseId ? ` Case: ${caseId}.` : "";
    const problems: string[] = [];
    let deletionSucceeded = false;
    if (action === "warn" || action === "delete_and_warn") {
      try {
        await message.author.send(`CommonGround moderation notice: ${reason}.${reference}`);
      } catch {
        problems.push("private warning could not be delivered");
      }
    }

    if (
      action === "delete" ||
      action === "delete_and_warn" ||
      action === "delete_and_strike"
    ) {
      if (message.deletable) {
        try {
          await message.delete();
          deletionSucceeded = true;
        } catch {
          problems.push("Discord rejected message deletion");
        }
      } else {
        problems.push("bot lacks permission to delete the message");
      }
    } else {
      deletionSucceeded = true;
    }

    let strikeLine = "";
    if (action === "delete_and_strike") {
      if (deletionSucceeded) {
        try {
          const strikeCount = await this.store.recordStrike(
            caseId ?? `automatic:${message.id}:${ruleId}`,
            message.guildId!,
            message.author.id,
            ruleId!,
          );
          strikeLine = `\nMember strike count: \`${strikeCount}\``;
        } catch {
          problems.push("message deleted but strike could not be persisted");
        }
      } else {
        problems.push("strike withheld because deletion did not complete");
      }
    }

    try {
      await this.log(
        `**CommonGround enforcement**\n${reason}\nAction: \`${action}\`${
          caseId ? `\nCase: \`${caseId}\`` : ""
        }${strikeLine}${problems.length ? `\nStatus: ${problems.join("; ")}` : ""}`,
        message.channelId,
      );
    } catch {
      problems.push("moderation log could not be delivered");
    }
    return {
      outcome: problems.length ? problems.some((problem) => problem.includes("lacks permission") || problem.includes("rejected message")) ? "failed" : "partial" : "applied",
      detail: problems.length ? problems.join("; ") : "Discord action and moderation log completed.",
    };
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
    await channel.send({ content, allowedMentions: { parse: [] } });
  }
}
