import {
  ActivityTracker,
  DEFAULT_RULES,
  evaluateRules,
  hashDiscordIdentifier,
  hashMessageSnapshot,
  type ConstitutionRule,
  type EditableRuleInput,
  type MessageSample,
} from "@commonground/core";
import type { Client, Message } from "discord.js";

import { DiscordActionExecutor } from "./actions.js";
import type { BotConfig } from "./config.js";
import type { ContractCase, ContractGateway } from "./contract-gateway.js";
import { logger } from "./logger.js";
import type {
  OperationKind,
  OperationStore,
  StoredOperation,
} from "./operation-store.js";
import { RuleCache } from "./rule-cache.js";

export interface DefaultRuleInstallResult {
  added: string[];
  updated: string[];
  skipped: string[];
  transactionHashes: string[];
}

export class ModerationService {
  readonly #activity = new ActivityTracker();
  readonly #cache: RuleCache;
  readonly #actions: DiscordActionExecutor;

  constructor(
    private readonly client: Client,
    private readonly config: BotConfig,
    private readonly gateway: ContractGateway,
    private readonly store: OperationStore,
  ) {
    this.#cache = new RuleCache(gateway);
    this.#actions = new DiscordActionExecutor(client, config, store);
  }

  guildKey(guildId: string): string {
    return hashDiscordIdentifier("guild", guildId);
  }

  async submitWrite(
    kind: OperationKind,
    guildId: string,
    functionName: string,
    args: Parameters<ContractGateway["write"]>[1],
    caseId?: string,
  ): Promise<string> {
    const submitted = await this.gateway.write(functionName, args);
    const now = new Date().toISOString();
    const operation: StoredOperation = {
      transactionHash: submitted.hash,
      kind,
      guildId,
      status: "submitted",
      submittedAt: now,
      updatedAt: now,
      ...(caseId === undefined ? {} : { caseId }),
    };
    await this.store.saveOperation(operation);
    return submitted.hash;
  }

  async finalize(hash: string): Promise<void> {
    try {
      await this.gateway.waitForSuccess(hash);
      await this.store.updateOperation(hash, "finalized");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.updateOperation(hash, "failed", message);
      throw error;
    }
  }

  async registerGuild(guildId: string, displayName: string): Promise<string> {
    const hash = await this.submitWrite(
      "register_guild",
      guildId,
      "register_guild",
      [this.guildKey(guildId), displayName],
    );
    void this.finalize(hash).catch((error) =>
      logger.error({ error, hash }, "guild registration failed"),
    );
    return hash;
  }

  async setupGuildWithDefaults(
    guildId: string,
    displayName: string,
  ): Promise<{ registrationHash: string; defaults: DefaultRuleInstallResult }> {
    const registrationHash = await this.submitWrite(
      "register_guild",
      guildId,
      "register_guild",
      [this.guildKey(guildId), displayName],
    );
    await this.finalize(registrationHash);
    const defaults = await this.installDefaultRules(guildId, false);
    return { registrationHash, defaults };
  }

  private ruleArguments(guildId: string, input: EditableRuleInput) {
    return [
      this.guildKey(guildId),
      input.ruleId,
      input.name,
      input.text,
      input.mode,
      input.detectorJson,
      input.exceptionsJson,
      input.scopeJson,
      input.action,
      input.appealAllowed,
    ] as Parameters<ContractGateway["write"]>[1];
  }

  async addRule(
    guildId: string,
    input: EditableRuleInput,
  ): Promise<string> {
    const hash = await this.submitWrite(
      "add_rule",
      guildId,
      "add_rule",
      this.ruleArguments(guildId, input),
    );
    void this.finalize(hash)
      .then(() => this.#cache.invalidate(this.guildKey(guildId)))
      .catch((error) => logger.error({ error, hash }, "rule creation failed"));
    return hash;
  }

  async updateRule(guildId: string, input: EditableRuleInput): Promise<string> {
    const hash = await this.submitWrite(
      "update_rule",
      guildId,
      "update_rule",
      this.ruleArguments(guildId, input),
    );
    void this.finalize(hash)
      .then(() => this.#cache.invalidate(this.guildKey(guildId)))
      .catch((error) => logger.error({ error, hash }, "rule update failed"));
    return hash;
  }

  async installDefaultRules(
    guildId: string,
    replaceExisting: boolean,
  ): Promise<DefaultRuleInstallResult> {
    const current = await this.gateway.listRules(this.guildKey(guildId));
    const byId = new Map(current.map((rule) => [rule.rule_id, rule]));
    const result: DefaultRuleInstallResult = {
      added: [],
      updated: [],
      skipped: [],
      transactionHashes: [],
    };

    for (const rule of DEFAULT_RULES) {
      const existing = byId.get(rule.ruleId);
      if (existing && !replaceExisting) {
        result.skipped.push(rule.ruleId);
        continue;
      }
      const functionName = existing ? "update_rule" : "add_rule";
      const kind = existing ? "update_rule" : "add_rule";
      const hash = await this.submitWrite(
        kind,
        guildId,
        functionName,
        this.ruleArguments(guildId, rule),
      );
      result.transactionHashes.push(hash);
      await this.finalize(hash);
      if (existing) result.updated.push(rule.ruleId);
      else result.added.push(rule.ruleId);
    }

    this.#cache.invalidate(this.guildKey(guildId));
    return result;
  }

  async disableRule(guildId: string, ruleId: string): Promise<string> {
    const hash = await this.submitWrite("disable_rule", guildId, "disable_rule", [
      this.guildKey(guildId),
      ruleId,
    ]);
    void this.finalize(hash)
      .then(() => this.#cache.invalidate(this.guildKey(guildId)))
      .catch((error) => logger.error({ error, hash }, "rule disable failed"));
    return hash;
  }

  async listRules(guildId: string): Promise<ConstitutionRule[]> {
    return this.#cache.get(this.guildKey(guildId));
  }

  async getCase(caseId: string): Promise<ContractCase> {
    return this.gateway.getCase(caseId);
  }

  async handleMessage(message: Message): Promise<void> {
    if (!message.guildId || message.author.bot) return;
    if (
      this.config.monitoredChannelIds.size > 0 &&
      !this.config.monitoredChannelIds.has(message.channelId)
    ) {
      return;
    }

    const sample: MessageSample = {
      id: message.id,
      guildId: message.guildId,
      channelId: message.channelId,
      authorId: message.author.id,
      content: message.content,
      createdAt: message.createdTimestamp,
      mentionCount: message.mentions.users.size,
    };
    const activity = this.#activity.snapshot(sample);
    this.#activity.record(sample);

    let rules: ConstitutionRule[];
    try {
      rules = await this.listRules(message.guildId);
    } catch (error) {
      logger.error({ error, guildId: message.guildId }, "failed to load rule set");
      return;
    }

    const evaluations = evaluateRules(rules, sample, activity);
    const violation = evaluations.find((evaluation) => evaluation.outcome === "violation");
    if (violation?.detector) {
      await this.#actions.execute(
        message,
        violation.action,
        `${violation.detector.reason} Rule ${violation.ruleId} v${violation.ruleVersion}`,
        undefined,
        violation.ruleId,
      );
      return;
    }

    const review = evaluations.find((evaluation) => evaluation.outcome === "review");
    if (review?.detector) {
      if (this.config.autoSubmitHybrid) {
        await this.openAndAdjudicateCase(
          message,
          review.ruleId,
          `Automatic detector requested review: ${review.detector.reason}`,
        );
      } else {
        await this.#actions.log(
          `**Possible rule issue**\nMessage: ${message.url}\nRule: \`${review.ruleId}\`\n${review.detector.reason}\nA moderator can use **Apps → Check Rule**.`,
        );
      }
    }
  }

  async openAndAdjudicateCase(
    message: Message,
    ruleId: string,
    challengeReason: string,
  ): Promise<{ caseId: string; openTransactionHash: string }> {
    if (!message.guildId) throw new Error("Cases require a server message");
    const caseId = `case-${message.id}-${ruleId.slice(0, 24)}`;
    const context = await this.buildContext(message);
    const messageHash = hashMessageSnapshot(message.content);
    await this.store.saveCaseBinding({
      caseId,
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
      authorId: message.author.id,
      messageHash,
      ruleId,
      action: "pending",
    });
    const openHash = await this.submitWrite(
      "open_case",
      message.guildId,
      "open_case",
      [
        caseId,
        this.guildKey(message.guildId),
        ruleId,
        messageHash,
        message.content,
        context,
        challengeReason,
      ],
      caseId,
    );
    void this.completeCaseWorkflow(caseId, openHash).catch((error) =>
      logger.error({ error, caseId, openHash }, "contextual case workflow failed"),
    );
    return { caseId, openTransactionHash: openHash };
  }

  async appealCase(
    guildId: string,
    caseId: string,
    appealReason: string,
  ): Promise<string> {
    const hash = await this.submitWrite(
      "appeal_case",
      guildId,
      "appeal_case",
      [caseId, appealReason],
      caseId,
    );
    void this.finalize(hash).catch((error) =>
      logger.error({ error, caseId, hash }, "appeal failed"),
    );
    return hash;
  }

  private async completeCaseWorkflow(caseId: string, openHash: string): Promise<void> {
    await this.finalize(openHash);
    const binding = await this.store.getCaseBinding(caseId);
    if (!binding) throw new Error(`Missing Discord binding for ${caseId}`);
    const decisionHash = await this.submitWrite(
      "adjudicate_case",
      binding.guildId,
      "adjudicate_case",
      [caseId],
      caseId,
    );
    await this.finalize(decisionHash);
    const decided = await this.gateway.getCase(caseId);
    await this.applyFinalizedDecision(decided);
  }

  private async applyFinalizedDecision(decided: ContractCase): Promise<void> {
    const binding = await this.store.getCaseBinding(decided.case_id);
    if (!binding) throw new Error(`Missing Discord binding for ${decided.case_id}`);
    if (decided.decision !== "violation") {
      await this.#actions.log(
        `**Case finalized**\nCase: \`${decided.case_id}\`\nDecision: \`${decided.decision}\`\n${decided.analysis}`,
      );
      return;
    }
    const channel = await this.client.channels.fetch(binding.channelId);
    if (!channel?.isTextBased() || !("messages" in channel)) {
      throw new Error("Bound case channel is unavailable");
    }
    const message = await channel.messages.fetch(binding.messageId).catch(() => null);
    if (!message) {
      await this.#actions.log(
        `Case \`${decided.case_id}\` finalized as a violation, but the source message was already unavailable.`,
      );
      return;
    }
    if (hashMessageSnapshot(message.content) !== binding.messageHash) {
      await this.#actions.log(
        `Case \`${decided.case_id}\` finalized as a violation, but the message changed after the case opened. No automatic deletion was performed.`,
      );
      return;
    }
    await this.#actions.execute(
      message,
      decided.rule_snapshot.action,
      `GenLayer finalized a violation of ${decided.rule_id} v${decided.rule_version}`,
      decided.case_id,
      decided.rule_id,
    );
  }

  async resumePendingOperations(): Promise<void> {
    const pending = await this.store.pendingOperations();
    const pendingAdjudications = new Set(
      pending
        .filter((operation) => operation.kind === "adjudicate_case")
        .map((operation) => operation.caseId)
        .filter((caseId): caseId is string => Boolean(caseId)),
    );
    for (const operation of pending) {
      try {
        if (operation.kind === "open_case" && operation.caseId) {
          await this.finalize(operation.transactionHash);
          if (pendingAdjudications.has(operation.caseId)) continue;
          const current = await this.gateway.getCase(operation.caseId);
          if (current.decision !== "pending") {
            await this.applyFinalizedDecision(current);
            continue;
          }
          const hash = await this.submitWrite(
            "adjudicate_case",
            operation.guildId,
            "adjudicate_case",
            [operation.caseId],
            operation.caseId,
          );
          await this.finalize(hash);
          await this.applyFinalizedDecision(await this.gateway.getCase(operation.caseId));
          continue;
        }
        await this.finalize(operation.transactionHash);
        if (operation.kind === "adjudicate_case" && operation.caseId) {
          await this.applyFinalizedDecision(await this.gateway.getCase(operation.caseId));
        } else if (operation.kind === "appeal_case" && operation.caseId) {
          const decided = await this.gateway.getCase(operation.caseId);
          await this.#actions.log(
            `**Appeal finalized**\nCase: \`${decided.case_id}\`\nDecision: \`${decided.decision}\`\n${decided.analysis}`,
          );
        } else if (
          operation.kind === "add_rule" ||
          operation.kind === "update_rule" ||
          operation.kind === "disable_rule"
        ) {
          this.#cache.invalidate(this.guildKey(operation.guildId));
        }
      } catch (error) {
        logger.error(
          { error, transactionHash: operation.transactionHash, kind: operation.kind },
          "failed to resume pending operation",
        );
      }
    }
  }

  private async buildContext(message: Message): Promise<string> {
    if (!("messages" in message.channel)) return "";
    const preceding = await message.channel.messages
      .fetch({ before: message.id, limit: 3 })
      .catch(() => null);
    if (!preceding) return "";
    return preceding
      .reverse()
      .map((item) => `${item.author.bot ? "bot" : "member"}: ${item.content}`)
      .join("\n")
      .slice(0, 8_000);
  }
}
