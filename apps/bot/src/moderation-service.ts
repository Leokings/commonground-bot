import {
  evidenceDigest,
  hashExactText,
  moderationCaseId,
  DEFAULT_RULES,
  evaluateRules,
  hashDiscordIdentifier,
  hashMessageSnapshot,
  type ActivitySnapshot,
  type ConstitutionRule,
  type EditableRuleInput,
  type MessageSample,
} from "@commonground/core";
import { randomUUID } from "node:crypto";
import type { CalldataEncodable } from "genlayer-js/types";
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
  CaseBinding,
  FinalizedDecision,
  EnforcementOutcome,
  OperationKind,
  OperationStore,
  StoredOperation,
} from "./operation-store.js";
import { RuleCache } from "./rule-cache.js";
import { FinalizedExecutionError } from "./transaction.js";
import { assertEvidenceText, evidenceExcerpt } from "./evidence-text.js";

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
  | { kind: "enforcement_issue"; checkedRules: number; ruleName: string; action: string; detail: string }
  | {
      kind: "submitted";
      checkedRules: number;
      ruleId: string;
      ruleName: string;
      caseId: string;
      transactionHash: string;
    }
  | { kind: "queued"; checkedRules: number; ruleId: string; ruleName: string; caseId: string }
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

export interface AppealRequester {
  userId: string;
  canModerate: boolean;
}

export interface AppealResult {
  transactionHash: string;
  case: ContractCase;
  pending?: boolean;
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
  readonly #workerId = randomUUID();
  #resuming = false;

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
    const broadcastId = randomUUID();
    const leaseId = randomUUID();
    if (!await this.store.acquireLease("relayer-write", leaseId, 300_000)) {
      throw new Error("Relayer busy; the queued case will retry without another signature");
    }
    let submitted;
    try {
      if ((await this.store.pendingBroadcasts()).length) {
        throw new Error("A signed transaction is awaiting network reconciliation; this write is safely queued.");
      }
      submitted = await this.gateway.write(functionName, args, async (raw, evmHash) => {
        await this.store.saveBroadcast({ id: broadcastId, raw, evmHash, kind, guildId,
          ...(caseId ? { caseId } : {}) });
      });
    } finally {
      await this.store.releaseLease("relayer-write", leaseId);
    }
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
    await this.store.completeBroadcast(broadcastId);
    return submitted.hash;
  }

  async finalize(hash: string): Promise<void> {
    try {
      await this.gateway.waitForSuccess(hash);
      await this.store.updateOperation(hash, "finalized");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof FinalizedExecutionError) await this.store.updateOperation(hash, "failed", message);
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
    adminWallet?: string,
  ): Promise<{ registrationHash: string; defaults: DefaultRuleInstallResult }> {
    if (this.gateway.protocol === 2 && (!/^0x[0-9a-fA-F]{40}$/.test(adminWallet ?? "") || /^0x0{40}$/.test(adminWallet!))) throw new Error("V2 setup requires your nonzero admin-wallet address. The bot receives case permission, not ownership of your rules.");
    const registrationHash = await this.submitWrite(
      "register_guild",
      guildId,
      "register_guild",
      [this.guildKey(guildId), displayName, ...(this.gateway.protocol === 2 ? [adminWallet!] : [])],
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

  async getCase(guildId: string, caseId: string): Promise<ContractCase> {
    const item = await this.gateway.getCase(caseId);
    this.assertCaseGuild(item, guildId);
    return item;
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
      const receipt = await this.#actions.execute(
        message,
        selection.rule.action,
        `Member report matched ${selection.rule.name}. ${selection.detectorReason ?? ""}`.trim(),
        undefined,
        selection.rule.rule_id,
      );
      if (receipt.outcome !== "applied") return { kind: "enforcement_issue", checkedRules: activeRules.length, ruleName: selection.rule.name, action: selection.rule.action, detail: receipt.detail };
      return {
        kind: "enforced",
        checkedRules: activeRules.length,
        ruleId: selection.rule.rule_id,
        ruleName: selection.rule.name,
        action: selection.rule.action,
      };
    }

    const caseId = this.caseId(message, selection.rule.rule_id, selection.rule.version);
    if (await this.store.getCaseBinding(caseId)) {
      return {
        kind: "already_reported",
        checkedRules: activeRules.length,
        ruleId: selection.rule.rule_id,
        ruleName: selection.rule.name,
        caseId,
      };
    }

    const reason = evidenceExcerpt([
      `Community report. CommonGround selected ${selection.rule.name} from ${activeRules.length} active rules.`,
      selection.detectorReason,
      challengeReason.trim() ? `Reporter context: ${challengeReason.trim()}` : undefined,
    ]
      .filter((item): item is string => Boolean(item))
      .join(" "), 2_000);
    const opened = await this.openAndAdjudicateCase(
      message,
      selection.rule.rule_id,
      selection.rule.action,
      reason,
    );
    if (opened.queued) {
      if (opened.duplicate) return { kind: "already_reported", checkedRules: activeRules.length, ruleId: selection.rule.rule_id, ruleName: selection.rule.name, caseId: opened.caseId };
      return { kind: "queued", checkedRules: activeRules.length, ruleId: selection.rule.rule_id, ruleName: selection.rule.name, caseId: opened.caseId };
    }
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
      case "enforcement_issue":
        return `**${result.ruleName}** matched and selected \`${result.action}\`, but Discord reported: ${result.detail}. A moderator should check the channel and bot permissions.`;
      case "submitted":
        return `Report accepted. I checked ${result.checkedRules} active rules and selected **${result.ruleName}** for GenLayer review. Case: \`${result.caseId}\`. Transaction: \`${result.transactionHash}\`.`;
      case "queued":
        return `Report queued. I checked ${result.checkedRules} active rules and selected **${result.ruleName}** for GenLayer review. Case: \`${result.caseId}\`. The case will appear on-chain after the bot submits it.`;
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
    action: ConstitutionRule["action"],
    challengeReason: string,
  ): Promise<{ caseId: string; openTransactionHash: string; queued?: false } | { caseId: string; queued: true; duplicate: boolean }> {
    if (!message.guildId) throw new Error("Cases require a server message");
    if (this.gateway.protocol === 2) return this.enqueueV2Case(message, ruleId, action, challengeReason);
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
      action,
      finalizedRevision: 0,
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
    return { caseId, openTransactionHash: openHash, queued: false };
  }

  async appealCase(
    guildId: string,
    caseId: string,
    appealReason: string,
    requester: AppealRequester,
  ): Promise<AppealResult> {
    assertEvidenceText(appealReason, 2_000);
    const binding = await this.store.getCaseBinding(caseId);
    if (!binding || binding.guildId !== guildId) {
      throw new Error("This case does not belong to this Discord server.");
    }
    if (binding.authorId !== requester.userId && !requester.canModerate) {
      throw new Error(
        "Only the author of the moderated message or a server moderator may appeal this case.",
      );
    }

    const current = await this.gateway.getCase(caseId);
    this.assertCaseGuild(current, guildId);
    const v2 = current.defense_deadline !== undefined && Boolean(binding.workflow);
    if (!v2) await this.applyFinalizedDecision(current);

    const guildKey = this.guildKey(guildId);
    const hash = await this.submitWrite(
      "appeal_case",
      guildId,
      "appeal_case",
      [guildKey, caseId, appealReason],
      caseId,
    );
    if (v2 && binding.workflow) {
      await this.store.updateWorkflow(caseId, { ...binding.workflow, stage: "waiting_appeal", hash });
      return { transactionHash: hash, case: current, pending: true };
    }
    const finalized = await this.finalizeCaseOperation(hash, caseId);
    return { transactionHash: hash, case: finalized };
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
    await this.finalizeCaseOperation(decisionHash, caseId);
  }

  private assertCaseGuild(item: ContractCase, guildId: string): void {
    if (item.guild_key !== this.guildKey(guildId)) {
      throw new Error("This case does not belong to this Discord server.");
    }
  }

  private async finalizeCaseOperation(
    transactionHash: string,
    caseId: string,
  ): Promise<ContractCase> {
    try {
      await this.gateway.waitForSuccess(transactionHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof FinalizedExecutionError) await this.store.updateOperation(transactionHash, "failed", message);
      throw error;
    }

    const decided = await this.gateway.getCase(caseId);
    await this.applyFinalizedDecision(decided);
    await this.store.updateOperation(transactionHash, "finalized");
    return decided;
  }

  private async applyFinalizedDecision(decided: ContractCase): Promise<void> {
    if (this.gateway.protocol === 2 && decided.defense_deadline !== undefined) {
      await this.reconcileV2Decision(decided);
      return;
    }
    const binding = await this.store.getCaseBinding(decided.case_id);
    if (!binding) throw new Error(`Missing Discord binding for ${decided.case_id}`);
    this.assertCaseGuild(decided, binding.guildId);
    if (decided.decision === "pending" || decided.decision_revision < 1) {
      throw new Error(`Case ${decided.case_id} has no finalized decision revision`);
    }

    if (decided.decision_revision <= binding.finalizedRevision) return;

    const priorHistory = decided.decision_history
      .filter((record) => record.revision < decided.decision_revision)
      .sort((left, right) => right.revision - left.revision)[0];
    const previousDecision = binding.finalizedDecision ?? priorHistory?.decision;
    const changed = Boolean(previousDecision && previousDecision !== decided.decision);
    let repair = "";

    if (decided.decision === "violation" && previousDecision !== "violation") {
      repair = await this.applyViolationDecision(decided, binding);
    } else if (changed && previousDecision === "violation") {
      const strikeRetracted =
        decided.rule_snapshot.action === "delete_and_strike"
          ? await this.store.retractStrike(decided.case_id)
          : false;
      const deletedContentNotice = ["delete", "delete_and_warn", "delete_and_strike"].includes(
        decided.rule_snapshot.action,
      )
        ? " Discord cannot restore content that was already deleted."
        : "";
      repair = `The previous violation outcome and its warning are withdrawn.${
        strikeRetracted ? " The recorded strike was removed." : ""
      }${deletedContentNotice}`;
    }

    const heading =
      decided.status === "appealed"
        ? changed
          ? "**Appeal revised the decision**"
          : "**Appeal finalized — decision unchanged**"
        : "**Case finalized**";
    const previousLine = previousDecision
      ? `\nPrevious decision: \`${previousDecision}\``
      : "";
    await this.#actions.log(
      `${heading}\nCase: \`${decided.case_id}\`\nRevision: \`${decided.decision_revision}\`${previousLine}\nDecision: \`${decided.decision}\`\n${decided.analysis}${
        repair ? `\nRepair: ${repair}` : ""
      }`,
      binding.channelId,
    );
    await this.store.updateCaseFinalizedState(
      decided.case_id,
      decided.decision_revision,
      decided.decision as FinalizedDecision,
    );
  }

  private async applyViolationDecision(
    decided: ContractCase,
    binding: CaseBinding,
  ): Promise<string> {
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
      return "The configured action could not be applied because the source message was unavailable.";
    }
    if (hashMessageSnapshot(message.content) !== binding.messageHash) {
      await this.#actions.log(
        `Case \`${decided.case_id}\` finalized as a violation, but the message changed after the case opened. No automatic deletion was performed.`,
        binding.channelId,
      );
      return "The configured action was withheld because the message no longer matched the reviewed snapshot.";
    }
    const receipt = await this.#actions.execute(
      message,
      decided.rule_snapshot.action,
      `GenLayer finalized a violation of ${decided.rule_id} v${decided.rule_version}`,
      decided.case_id,
      decided.rule_id,
    );
    return receipt.outcome === "applied"
      ? `The configured \`${decided.rule_snapshot.action}\` action was applied.`
      : `Discord action outcome: ${receipt.outcome}. ${receipt.detail} A moderator should inspect the channel; full enforcement was not confirmed.`;
  }

  async resumePendingOperations(): Promise<void> {
    if (this.#resuming) return;
    this.#resuming = true;
    let leaseAcquired = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
    if (!await this.store.acquireLease("recovery-worker", this.#workerId, 60_000)) return;
    leaseAcquired = true;
    let renew = Promise.resolve();
    heartbeat = setInterval(() => {
      renew = renew.then(async () => {
        if (!await this.store.acquireLease("recovery-worker", this.#workerId, 60_000)) {
          logger.warn("Recovery worker lease was lost; a later pass will resume outstanding work");
        }
      }).catch(() => logger.warn("Recovery worker lease renewal failed"));
    }, 15_000);
    heartbeat.unref();
    for (const record of await this.store.pendingBroadcasts()) {
      if (!this.gateway.recoverBroadcast) { await this.store.touchBroadcast(record.id); continue; }
      try {
        const hash = await this.gateway.recoverBroadcast(record);
        if (!hash) { await this.store.touchBroadcast(record.id); continue; }
        const now = new Date().toISOString();
        await this.store.saveOperation({ transactionHash: hash, kind: record.kind,
          guildId: record.guildId, status: "submitted", submittedAt: now, updatedAt: now,
          ...(record.caseId ? { caseId: record.caseId } : {}) });
        if (record.caseId) {
          const binding = await this.store.getCaseBinding(record.caseId);
          if (binding?.workflow && (record.kind === "open_case" || record.kind === "adjudicate_case")) {
            await this.store.updateWorkflow(record.caseId, { ...binding.workflow, hash,
              stage: record.kind === "open_case" ? "opening" : "reviewing" });
          }
        }
        await this.store.completeBroadcast(record.id);
      } catch (error) {
        if (error instanceof FinalizedExecutionError) {
          await this.store.completeBroadcast(record.id);
          if (record.caseId) {
            const binding = await this.store.getCaseBinding(record.caseId);
            if (binding?.workflow) await this.store.updateWorkflow(record.caseId, { ...binding.workflow, stage: "blocked", error: "Finalized submission reverted" });
          }
        }
        else await this.store.touchBroadcast(record.id);
        logger.warn({ broadcastId: record.id }, "Persisted submission still requires reconciliation");
      }
    }
    if (this.gateway.protocol === 2) {
      for (const binding of await this.store.pendingCases()) {
        try {
          let ready = true;
          const caseWrites = (await this.store.pendingOperations()).filter((operation) => operation.caseId === binding.caseId);
          for (const operation of caseWrites) {
            if (!this.gateway.isFinalizedSuccess || !await this.gateway.isFinalizedSuccess(operation.transactionHash)) {
              ready = false;
              break;
            }
            await this.store.updateOperation(operation.transactionHash, "finalized");
          }
          if (ready) await this.processV2Case(binding);
          else if (binding.workflow) await this.store.updateWorkflow(binding.caseId, binding.workflow);
        }
        catch (error) {
          if (error instanceof FinalizedExecutionError && binding.workflow) {
            await this.store.updateWorkflow(binding.caseId, { ...binding.workflow, stage: "blocked", error: "Finalized contract execution failed; inspect case status" });
          }
          logger.warn({ caseId: binding.caseId }, "Case remains queued for reconciliation");
        }
      }
    }
    const pending = await this.store.pendingOperations();
    const pendingAdjudications = new Set(
      pending
        .filter((operation) => operation.kind === "adjudicate_case")
        .map((operation) => operation.caseId)
        .filter((caseId): caseId is string => Boolean(caseId)),
    );
    for (const operation of pending) {
      const binding = operation.caseId ? await this.store.getCaseBinding(operation.caseId) : null;
      if (binding?.workflow) continue;
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
          await this.finalizeCaseOperation(hash, operation.caseId);
          continue;
        }
        if (
          (operation.kind === "adjudicate_case" || operation.kind === "appeal_case") &&
          operation.caseId
        ) {
          await this.finalizeCaseOperation(operation.transactionHash, operation.caseId);
          continue;
        }
        await this.finalize(operation.transactionHash);
        if (
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
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (leaseAcquired) await this.store.releaseLease("recovery-worker", this.#workerId);
      this.#resuming = false;
    }
  }

  private async enqueueV2Case(message: Message, ruleId: string, action: string, reason: string): Promise<{ caseId: string; queued: true; duplicate: boolean }> {
    const rules = await this.gateway.listRules(this.guildKey(message.guildId!));
    const rule = rules.find((item) => item.rule_id === ruleId && item.active);
    if (!rule) throw new Error("The selected rule is no longer active; report again to refresh it");
    const guild = this.guildKey(message.guildId!);
    const messageKey = hashDiscordIdentifier("message", message.id);
    const channelKey = hashDiscordIdentifier("channel", message.channelId);
    const authorKey = hashDiscordIdentifier("author", message.author.id);
    const context = await this.buildContext(message);
    assertEvidenceText(message.content, 4_000);
    assertEvidenceText(reason, 2_000);
    const messageHash = hashExactText(message.content);
    const caseId = moderationCaseId(guild, messageKey, ruleId, rule.version, messageHash);
    const digest = evidenceDigest([guild, ruleId, String(rule.version), messageKey, channelKey,
      authorKey, message.content, context, reason]);
    const args = [caseId, guild, ruleId, rule.version, messageHash, message.content, context,
      reason, digest, messageKey, channelKey, authorKey];
    const claimed = await this.store.claimCase({ caseId, guildId: message.guildId!,
      channelId: message.channelId, messageId: message.id, authorId: message.author.id,
      messageHash, ruleId, action, finalizedRevision: 0, workflow: { args, stage: "queued" } });
    if (!claimed) return { caseId, queued: true, duplicate: true };
    void this.resumePendingOperations();
    return { caseId, queued: true, duplicate: false };
  }

  async caseProgress(guildId: string, caseId: string): Promise<{ stage: string; transactionHash?: string; revision: number; decision?: string; defenseDeadline?: number; appealDeadline?: number }> {
    const binding = await this.store.getCaseBinding(caseId);
    if (!binding || binding.guildId !== guildId) throw new Error("This case does not belong to this Discord server.");
    if (binding.workflow && ["queued", "opening"].includes(binding.workflow.stage)) return { stage: binding.workflow.stage, ...(binding.workflow.hash ? { transactionHash: binding.workflow.hash } : {}), revision: binding.finalizedRevision, ...(binding.finalizedDecision ? { decision: binding.finalizedDecision } : {}) };
    const item = await this.getCase(guildId, caseId);
    return { stage: binding.workflow?.stage ?? item.status, revision: item.decision_revision, decision: item.decision,
      ...(binding.workflow?.hash ? { transactionHash: binding.workflow.hash } : {}),
      ...(item.status === "awaiting_defense" && item.defense_deadline ? { defenseDeadline: item.defense_deadline } : {}),
      ...(item.status === "decided" && item.decision === "violation" && item.rule_snapshot.appeal_allowed && item.appeal_deadline ? { appealDeadline: item.appeal_deadline } : {}) };
  }

  async publicCase(caseId: string): Promise<Record<string, unknown> | null> {
    if (this.gateway.protocol !== 2 || !/^case-[0-9a-f]{64}$/u.test(caseId)) return null;
    const item = await this.gateway.getCase(caseId);
    const eligibility = await this.gateway.readPublic!("get_enforcement", [caseId]) as Record<string, unknown>;
    const execution = await this.gateway.readPublic!("get_enforcement", [caseId, item.decision_revision], "ledger") as Record<string, unknown>;
    return {
      caseId: item.case_id,
      status: item.status,
      decision: item.decision,
      revision: item.decision_revision,
      ruleId: item.rule_id,
      ruleVersion: item.rule_version,
      evidenceDigest: item.evidence_digest,
      enforcement: eligibility,
      executorReceipt: execution,
      history: item.decision_history.map((record) => ({
        revision: record.revision,
        kind: record.kind,
        decision: record.decision,
        analysis: record.analysis,
        decidedAt: record.decided_at,
      })),
    };
  }

  private async processV2Case(binding: CaseBinding): Promise<void> {
    let workflow = binding.workflow!;
    const save = async (next: typeof workflow) => {
      workflow = next;
      await this.store.updateWorkflow(binding.caseId, workflow);
    };
    if (workflow.stage === "queued") {
      await save({ ...workflow, stage: "opening" });
      try {
        const hash = await this.submitWrite("open_case", binding.guildId, "open_case", workflow.args as CalldataEncodable[], binding.caseId);
        await save({ ...workflow, hash, stage: "opening" });
      } catch (error) {
        if (!(await this.store.pendingBroadcasts()).some((item) => item.caseId === binding.caseId)) await save({ ...workflow, stage: "queued" });
        throw error;
      }
      return;
    }
    if (workflow.stage === "opening" || workflow.stage === "reviewing") {
      let hash = workflow.hash;
      if (!hash) {
        const operation = await this.store.latestCaseOperation(binding.caseId, workflow.stage === "opening" ? "open_case" : "adjudicate_case");
        if (!operation) {
          // A crash can occur after saving the stage but before signing. Only
          // reset when no persisted signature could already be on the network.
          if (!(await this.store.pendingBroadcasts()).some((entry) => entry.caseId === binding.caseId)) {
            await save({ ...workflow, stage: workflow.stage === "opening" ? "queued" : "waiting_defense" });
          }
          return;
        }
        hash = operation.transactionHash;
        workflow = { ...workflow, hash };
        await save(workflow);
      }
      if (!await this.gateway.isFinalizedSuccess!(hash)) { await save(workflow); return; }
      await this.store.updateOperation(hash, "finalized");
      await save({ ...workflow, stage: workflow.stage === "opening" ? "waiting_defense" : "waiting_appeal" });
    }
    const item = await this.gateway.getCase(binding.caseId);
    if (["awaiting_defense", "awaiting_context", "context_supplied"].includes(item.status)
        && Math.floor(Date.now() / 1000) >= (item.context_deadline ?? Number.MAX_SAFE_INTEGER)) {
      const hash = await this.submitWrite("expire_case", binding.guildId, "expire_case", [binding.caseId], binding.caseId);
      await save({ ...workflow, hash, stage: "waiting_context" });
      return;
    }
    if (item.status === "awaiting_defense" || item.status === "context_supplied") {
      if (item.status === "awaiting_defense" && !workflow.defenseAnnounced) {
        await this.#actions.log(`**Case opened — response window**\nCase: \`${item.case_id}\`\nThe reported-message author or a server moderator can use \`/case defend\` before <t:${item.defense_deadline}:F>. Evidence is public and permanent. Review continues after this window.`, binding.channelId);
        await save({ ...workflow, defenseAnnounced: true });
      }
      if (Math.floor(Date.now() / 1000) <= (item.defense_deadline ?? 0)) { await save({ ...workflow, stage: "waiting_defense" }); return; }
      await save({ ...workflow, stage: "reviewing", hash: undefined });
      try {
        const hash = await this.submitWrite("adjudicate_case", binding.guildId, "adjudicate_case", [binding.caseId], binding.caseId);
        await save({ ...workflow, hash });
      } catch (error) {
        if (!(await this.store.pendingBroadcasts()).some((entry) => entry.caseId === binding.caseId)) await save({ ...workflow, stage: "waiting_defense" });
        throw error;
      }
      return;
    }
    await this.reconcileV2Decision(item);
  }

  private async reconcileV2Decision(item: ContractCase): Promise<void> {
    const binding = await this.store.getCaseBinding(item.case_id);
    if (!binding?.workflow) throw new Error("Missing durable case workflow");
    this.assertCaseGuild(item, binding.guildId);
    let workflow = binding.workflow;
    if (item.status === "closed_unresolved" && item.decision_revision === 0) {
      await this.#actions.log(`**Case closed without a decision**\nCase: \`${item.case_id}\`\nThe review deadline passed. No Discord penalty was authorized.`, binding.channelId);
      await this.store.updateWorkflow(item.case_id, { ...workflow, stage: "complete" });
      return;
    }
    if (item.decision === "pending") return;
    if (item.decision_revision > binding.finalizedRevision) {
      const changedFromViolation = binding.finalizedDecision === "violation" && item.decision !== "violation";
      const cleanup = changedFromViolation
        ? ` The previous violation outcome is withdrawn. ${["delete", "delete_and_warn", "delete_and_strike"].includes(item.rule_snapshot.action) ? "Discord cannot restore a message that was already deleted." : ""}`
        : "";
      const strikeRetracted = changedFromViolation && item.rule_snapshot.action === "delete_and_strike"
        ? await this.store.retractStrike(item.case_id)
        : false;
      const nextStep = item.decision === "needs_context"
        ? item.status === "closed_unresolved" ? "The case is closed without an enforceable verdict." : "Use /case context to supply missing public context."
        : item.appeal_count ? "Appeal finalized."
        : item.decision === "violation" && item.rule_snapshot.appeal_allowed
          ? `The reported-message author or a moderator may use /case appeal before <t:${item.appeal_deadline}:F>. Enforcement waits for this deadline.`
          : "No appeal is available for this decision.";
      await this.#actions.log(`**Case decision**\nCase: \`${item.case_id}\`\nRevision: ${item.decision_revision}\nDecision: \`${item.decision}\`\n${item.analysis}\n${nextStep}${cleanup}${strikeRetracted ? " The recorded strike was removed." : ""}`, binding.channelId);
      await this.store.updateCaseFinalizedState(item.case_id, item.decision_revision, item.decision);
    }
    if (item.status === "awaiting_context") {
      await this.store.updateWorkflow(item.case_id, { ...workflow, stage: "waiting_context" });
      return;
    }
    const eligibility = await this.gateway.readPublic!("get_enforcement", [item.case_id]) as { eligible: boolean };
    if (item.decision === "violation" && !eligibility.eligible) {
      await this.store.updateWorkflow(item.case_id, { ...workflow, stage: "waiting_appeal" });
      return;
    }
    if (workflow.actionRevision !== item.decision_revision) {
      const priorOutcome = workflow.actionOutcome;
      const priorDetail = workflow.actionDetail;
      const sameViolation = binding.finalizedDecision === "violation" && item.decision === "violation";
      const carryForward = sameViolation && priorOutcome && priorOutcome !== "no_action";
      workflow = { ...workflow,
        actionOutcome: carryForward ? (priorOutcome === "applied" ? "already_applied" : priorOutcome) : undefined,
        actionDetail: carryForward ? `No duplicate Discord action was attempted after the appeal. Earlier outcome: ${priorOutcome}. ${priorDetail ?? ""}` : undefined,
        actionStarted: Boolean(carryForward), actionRevision: item.decision_revision, ledgerHash: undefined };
      await this.store.updateWorkflow(item.case_id, workflow);
    }
    if (workflow.actionStarted && !workflow.actionOutcome) {
      workflow = { ...workflow, actionOutcome: "unknown", actionDetail: "The worker restarted after beginning the Discord action. It did not repeat the action because Discord and the database cannot commit atomically; a moderator must inspect the channel.", stage: "executing" };
      await this.store.updateWorkflow(item.case_id, workflow);
    }
    if (!workflow.actionOutcome) {
      await this.store.updateWorkflow(item.case_id, { ...workflow, stage: "executing" });
      let outcome: EnforcementOutcome = "no_action";
      let detail = "No Discord penalty is authorized for this decision.";
      if (item.decision === "violation") {
        const channel = await this.client.channels.fetch(binding.channelId);
        if (!channel?.isTextBased() || !("messages" in channel)) throw new Error("Case channel unavailable");
        const message = await channel.messages.fetch(binding.messageId).catch(() => null);
        if (!message) { outcome = "unavailable"; detail = "Source message unavailable; no deletion claimed."; }
        else if (hashExactText(message.content) !== item.message_hash) { outcome = "withheld_changed"; detail = "Message bytes changed; action withheld."; }
        else {
          if (!await this.store.acquireLease("recovery-worker", this.#workerId, 60_000)) {
            throw new Error("Recovery lease was lost; Discord action deferred to the active worker");
          }
          workflow = { ...workflow, actionStarted: true, actionRevision: item.decision_revision, stage: "executing" };
          await this.store.updateWorkflow(item.case_id, workflow);
          const action = await this.#actions.execute(message, item.rule_snapshot.action, "Finalized contextual violation after appeal eligibility", item.case_id, item.rule_id);
          outcome = action.outcome; detail = `${action.detail} This is an executor report, not independent Discord proof.`;
        }
      } else if (binding.finalizedDecision === "violation") {
        await this.store.retractStrike(item.case_id);
      }
      workflow = { ...workflow, actionOutcome: outcome, actionDetail: detail, actionRevision: item.decision_revision, actionStarted: true, stage: "executing" };
      await this.store.updateWorkflow(item.case_id, workflow);
    }
    if (!workflow.ledgerHash) {
      const receipt = await this.gateway.readPublic!("get_enforcement", [item.case_id, item.decision_revision], "ledger") as Record<string, unknown>;
      if (!Object.keys(receipt).length) {
        const outstanding = (await this.store.pendingBroadcasts()).some((entry) => entry.caseId === item.case_id && entry.kind === "record_enforcement");
        if (outstanding) return;
        const hash = await this.submitWrite("record_enforcement", binding.guildId, "record_enforcement", [item.guild_key, item.case_id, item.decision_revision, workflow.actionOutcome!, hashExactText(workflow.actionDetail!)], item.case_id);
        workflow = { ...workflow, ledgerHash: hash };
        await this.store.updateWorkflow(item.case_id, workflow);
      }
    }
    if (workflow.ledgerHash && !await this.gateway.isFinalizedSuccess!(workflow.ledgerHash)) return;
    if (workflow.ledgerHash) await this.store.updateOperation(workflow.ledgerHash, "finalized");
    await this.store.updateWorkflow(item.case_id, { ...workflow, stage: "complete" });
  }

  async defendCase(guildId: string, caseId: string, reason: string, requester: AppealRequester): Promise<string> {
    assertEvidenceText(reason, 2_000);
    const binding = await this.store.getCaseBinding(caseId);
    if (!binding || binding.guildId !== guildId || (binding.authorId !== requester.userId && !requester.canModerate)) throw new Error("Only the reported author or a server moderator can supply evidence.");
    const item = await this.getCase(guildId, caseId);
    if (!item.defense_deadline) throw new Error("Defense commands require a v2 case");
    const method = item.status === "awaiting_context" ? "supply_context" : "submit_defense";
    const args: CalldataEncodable[] = method === "supply_context" ? [item.guild_key, caseId, item.decision_revision, reason] : [item.guild_key, caseId, reason];
    const hash = await this.submitWrite(method, guildId, method, args, caseId);
    if (binding.workflow) await this.store.updateWorkflow(caseId, { ...binding.workflow, hash,
      stage: method === "supply_context" ? "waiting_context" : "waiting_defense" });
    else await this.finalize(hash);
    return hash;
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
    if (replyParent && replyParent.guildId === message.guildId && isPublicReportMessage(replyParent)) {
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
    return evidenceExcerpt(context.join("\n"), 8_000);
  }

  private caseId(message: Message, ruleId: string, version = 1): string {
    if (this.gateway.protocol === 2) return moderationCaseId(this.guildKey(message.guildId!), hashDiscordIdentifier("message", message.id), ruleId, version, hashExactText(message.content));
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
