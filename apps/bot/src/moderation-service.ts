import {
  DEFAULT_RULES,
  evaluateRules,
  hashDiscordIdentifier,
  hashMessageSnapshot,
  type ActivitySnapshot,
  type ConstitutionRule,
  type EditableRuleInput,
  type MessageSample,
} from "@commonground/core";
import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Message,
} from "discord.js";

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

export type ReportReviewResult =
  | {
      kind: "enforced";
      checkedRules: number;
      ruleId: string;
      ruleName: string;
      action: string;
    }
  | {
      kind: "submitted";
      checkedRules: number;
      ruleId: string;
      ruleName: string;
      caseId: string;
      transactionHash: string;
    }
  | {
      kind: "already_reported";
      checkedRules: number;
      ruleId: string;
      ruleName: string;
      caseId: string;
    }
  | { kind: "clear"; checkedRules: number }
  | { kind: "channel_not_configured"; checkedRules: 0 };

export interface ReportRuleSelection {
  kind: "enforce" | "review";
  rule: ConstitutionRule;
  detectorReason?: string;
}

export function parseReplyReport(
  content: string,
  botUserId: string,
): { reason: string } | null {
  const withoutMention = content
    .replace(new RegExp(`<@!?${botUserId}>`, "gu"), " ")
    .replace(/\s+/gu, " ")
    .trim();
  const match = /^(?:please\s+)?(?:report|review|check)\b\s*(.*)$/iu.exec(
    withoutMention,
  );
  if (!match) return null;
  const reason = (match[1] ?? "")
    .replace(/^(?:this|message)\b\s*[:\-]?\s*/iu, "")
    .trim();
  return { reason };
}

export function selectRuleForReport(
  rules: ReadonlyArray<ConstitutionRule>,
  sample: MessageSample,
  activity: ActivitySnapshot = { authorMessages: [] },
): ReportRuleSelection | null {
  const activeRules = rules.filter((rule) => rule.active);
  const byId = new Map(activeRules.map((rule) => [rule.rule_id, rule]));
  const evaluations = evaluateRules(activeRules, sample, activity);

  const deterministic = evaluations.find(
    (evaluation) => evaluation.outcome === "violation" && evaluation.detector,
  );
  if (deterministic?.detector) {
    const rule = byId.get(deterministic.ruleId);
    if (rule) {
      return {
        kind: "enforce",
        rule,
        detectorReason: deterministic.detector.reason,
      };
    }
  }

  const detectedReview = evaluations.find(
    (evaluation) => evaluation.outcome === "review" && evaluation.detector,
  );
  if (detectedReview?.detector) {
    const rule = byId.get(detectedReview.ruleId);
    if (rule) {
      return {
        kind: "review",
        rule,
        detectorReason: detectedReview.detector.reason,
      };
    }
  }

  const contextual =
    activeRules.find(
      (rule) => rule.rule_id === "no-targeted-abuse" && rule.mode === "contextual",
    ) ?? activeRules.find((rule) => rule.mode === "contextual");
  if (contextual) return { kind: "review", rule: contextual };

  const hybrid = activeRules.find((rule) => rule.mode === "hybrid");
  return hybrid ? { kind: "review", rule: hybrid } : null;
}

export function isPublicReportMessage(message: Message): boolean {
  if (!message.inGuild()) return false;
  if (message.channel.type === ChannelType.PrivateThread) return false;
  return Boolean(
    message.channel
      .permissionsFor(message.guild.roles.everyone)
      ?.has(PermissionFlagsBits.ViewChannel),
  );
}

export class ModerationService {
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
    const botUserId = this.client.user?.id;
    if (!botUserId || !message.mentions.users.has(botUserId)) return;
    const request = parseReplyReport(message.content, botUserId);
    if (!request) return;

    if (!message.reference?.messageId) {
      await message.reply(
        "Reply directly to the message you want checked, then type `@CommonGround report`. You can also use `/report` with a Discord message link.",
      );
      return;
    }

    const target = await message.fetchReference().catch(() => null);
    if (!target || target.guildId !== message.guildId) {
      await message.reply("I could not access the message you replied to.");
      return;
    }

    const result = await this.reviewReportedMessage(
      target,
      request.reason || "A server member requested a review.",
    );
    await message.reply(this.reportResultMessage(result));
  }

  async reviewReportedMessage(
    message: Message,
    challengeReason: string,
  ): Promise<ReportReviewResult> {
    if (!message.guildId) throw new Error("Reports require a server message");
    if (!isPublicReportMessage(message)) {
      return { kind: "channel_not_configured", checkedRules: 0 };
    }
    const appliesTestGuildAllowlist =
      this.config.discordTestGuildId === message.guildId &&
      this.config.monitoredChannelIds.size > 0;
    if (
      appliesTestGuildAllowlist &&
      !this.config.monitoredChannelIds.has(message.channelId)
    ) {
      return { kind: "channel_not_configured", checkedRules: 0 };
    }

    const rules = await this.listRules(message.guildId);
    const activeRules = rules.filter((rule) => rule.active);
    const sample = this.messageSample(message);
    const activity = await this.buildActivityForReport(message);
    const selection = selectRuleForReport(activeRules, sample, activity);
    if (!selection) return { kind: "clear", checkedRules: activeRules.length };

    if (selection.kind === "enforce") {
      await this.#actions.execute(
        message,
        selection.rule.action,
        `Member report matched ${selection.rule.name}. ${selection.detectorReason ?? ""}`.trim(),
        undefined,
        selection.rule.rule_id,
      );
      return {
        kind: "enforced",
        checkedRules: activeRules.length,
        ruleId: selection.rule.rule_id,
        ruleName: selection.rule.name,
        action: selection.rule.action,
      };
    }

    const caseId = this.caseId(message, selection.rule.rule_id);
    if (await this.store.getCaseBinding(caseId)) {
      return {
        kind: "already_reported",
        checkedRules: activeRules.length,
        ruleId: selection.rule.rule_id,
        ruleName: selection.rule.name,
        caseId,
      };
    }

    const reason = [
      `Community report. CommonGround selected ${selection.rule.name} from ${activeRules.length} active rules.`,
      selection.detectorReason,
      challengeReason.trim() ? `Reporter context: ${challengeReason.trim()}` : undefined,
    ]
      .filter((item): item is string => Boolean(item))
      .join(" ")
      .slice(0, 2_000);
    const opened = await this.openAndAdjudicateCase(
      message,
      selection.rule.rule_id,
      reason,
    );
    return {
      kind: "submitted",
      checkedRules: activeRules.length,
      ruleId: selection.rule.rule_id,
      ruleName: selection.rule.name,
      caseId: opened.caseId,
      transactionHash: opened.openTransactionHash,
    };
  }

  reportResultMessage(result: ReportReviewResult): string {
    switch (result.kind) {
      case "enforced":
        return `Checked ${result.checkedRules} active rules. **${result.ruleName}** matched, so the configured \`${result.action}\` action was applied.`;
      case "submitted":
        return `Report accepted. I checked ${result.checkedRules} active rules and selected **${result.ruleName}** for GenLayer review. Case: \`${result.caseId}\`. Transaction: \`${result.transactionHash}\`.`;
      case "already_reported":
        return `That message is already being reviewed under **${result.ruleName}**. Case: \`${result.caseId}\`.`;
      case "channel_not_configured":
        return "This channel is not configured for public CommonGround review.";
      case "clear":
        return `Checked ${result.checkedRules} active rules, but none can be applied to this report.`;
    }
  }

  async openAndAdjudicateCase(
    message: Message,
    ruleId: string,
    challengeReason: string,
  ): Promise<{ caseId: string; openTransactionHash: string }> {
    if (!message.guildId) throw new Error("Cases require a server message");
    const caseId = this.caseId(message, ruleId);
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
        binding.channelId,
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
        binding.channelId,
      );
      return;
    }
    if (hashMessageSnapshot(message.content) !== binding.messageHash) {
      await this.#actions.log(
        `Case \`${decided.case_id}\` finalized as a violation, but the message changed after the case opened. No automatic deletion was performed.`,
        binding.channelId,
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
          const binding = await this.store.getCaseBinding(operation.caseId);
          await this.#actions.log(
            `**Appeal finalized**\nCase: \`${decided.case_id}\`\nDecision: \`${decided.decision}\`\n${decided.analysis}`,
            binding?.channelId,
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
    const [replyParent, preceding, following] = await Promise.all([
      message.reference?.messageId
        ? message.fetchReference().catch(() => null)
        : Promise.resolve(null),
      message.channel.messages
        .fetch({ before: message.id, limit: 3 })
        .catch(() => null),
      message.channel.messages
        .fetch({ after: message.id, limit: 3 })
        .catch(() => null),
    ]);

    const labels = new Map<string, string>();
    let nextMember = 1;
    const authorLabel = (item: Message): string => {
      if (item.author.bot) return "bot";
      if (item.author.id === message.author.id) return "reported-author";
      let label = labels.get(item.author.id);
      if (!label) {
        label = `member-${nextMember}`;
        nextMember += 1;
        labels.set(item.author.id, label);
      }
      return label;
    };
    const line = (position: string, item: Message): string =>
      `${position} [${authorLabel(item)}]: ${item.content.slice(0, 2_000)}`;
    const isReportCommand = (item: Message): boolean => {
      const botUserId = this.client.user?.id;
      return Boolean(
        botUserId &&
          item.mentions.users.has(botUserId) &&
          parseReplyReport(item.content, botUserId),
      );
    };

    const context: string[] = [];
    if (replyParent) {
      context.push(line("replied-to", replyParent));
    }

    const parentId = replyParent?.id;
    const before = preceding
      ? Array.from(preceding.values())
          .filter(
            (item) =>
              item.id !== parentId &&
              !item.author.bot &&
              !isReportCommand(item),
          )
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      : [];
    const after = following
      ? Array.from(following.values())
          .filter((item) => !item.author.bot && !isReportCommand(item))
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      : [];
    context.push(...before.map((item) => line("before", item)));
    context.push(...after.map((item) => line("after", item)));
    return context.join("\n").slice(0, 8_000);
  }

  private caseId(message: Message, ruleId: string): string {
    return `case-${message.id}-${ruleId.slice(0, 24)}`;
  }

  private messageSample(message: Message): MessageSample {
    return {
      id: message.id,
      guildId: message.guildId ?? "",
      channelId: message.channelId,
      authorId: message.author.id,
      content: message.content,
      createdAt: message.createdTimestamp,
      mentionCount:
        message.mentions.users.size +
        (message.mentions.everyone ? 1 : 0),
    };
  }

  private async buildActivityForReport(message: Message): Promise<ActivitySnapshot> {
    if (!("messages" in message.channel)) return { authorMessages: [] };
    const preceding = await message.channel.messages
      .fetch({ before: message.id, limit: 100 })
      .catch(() => null);
    if (!preceding) return { authorMessages: [] };
    return {
      authorMessages: preceding
        .filter((item) => item.author.id === message.author.id)
        .map((item) => this.messageSample(item)),
    };
  }
}
