import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
  type MessageContextMenuCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { EditableRuleInput } from "@commonground/core";

import type { ModerationService } from "./moderation-service.js";

const EPHEMERAL = MessageFlags.Ephemeral;

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("rule")
    .setDescription("Manage this server's GenLayer-backed rules")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((command) =>
      command
        .setName("setup")
        .setDescription("Register this server and install the starter rule pack")
        .addStringOption((option) =>
          option
            .setName("display-name")
            .setDescription("Public name stored with the rule set")
            .setRequired(true)
            .setMaxLength(120),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("install-defaults")
        .setDescription("Install missing starter rules or restore their latest versions")
        .addBooleanOption((option) =>
          option
            .setName("replace-existing")
            .setDescription("Create new versions for starter rules that already exist"),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("add-rule")
        .setDescription("Create a versioned server rule")
        .addStringOption((option) =>
          option
            .setName("rule-id")
            .setDescription("Stable identifier, such as no-targeted-abuse")
            .setRequired(true)
            .setMaxLength(48),
        )
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("How the rule is enforced")
            .setRequired(true)
            .addChoices(
              { name: "Automatic", value: "automatic" },
              { name: "Contextual", value: "contextual" },
              { name: "Hybrid", value: "hybrid" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Predetermined consequence for a violation")
            .setRequired(true)
            .addChoices(
              { name: "Warn", value: "warn" },
              { name: "Delete", value: "delete" },
              { name: "Delete and warn", value: "delete_and_warn" },
              { name: "Delete and strike", value: "delete_and_strike" },
              { name: "Log only", value: "log_only" },
            ),
        )
        .addBooleanOption((option) =>
          option
            .setName("appeal")
            .setDescription("Whether one appeal is allowed")
            .setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("edit-rule")
        .setDescription("Create a new version of an existing server rule")
        .addStringOption((option) =>
          option
            .setName("rule-id")
            .setDescription("Stable identifier of the rule to update")
            .setRequired(true)
            .setMaxLength(48),
        )
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("How the new rule version is enforced")
            .setRequired(true)
            .addChoices(
              { name: "Automatic", value: "automatic" },
              { name: "Contextual", value: "contextual" },
              { name: "Hybrid", value: "hybrid" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Predetermined consequence for a violation")
            .setRequired(true)
            .addChoices(
              { name: "Warn", value: "warn" },
              { name: "Delete", value: "delete" },
              { name: "Delete and warn", value: "delete_and_warn" },
              { name: "Delete and strike", value: "delete_and_strike" },
              { name: "Log only", value: "log_only" },
            ),
        )
        .addBooleanOption((option) =>
          option
            .setName("appeal")
            .setDescription("Whether one appeal is allowed")
            .setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command.setName("list").setDescription("List finalized active rule versions"),
    )
    .addSubcommand((command) =>
      command
        .setName("disable-rule")
        .setDescription("Disable a server rule")
        .addStringOption((option) =>
          option.setName("rule-id").setDescription("Rule identifier").setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName("case")
    .setDescription("View or appeal a rule-based moderation case")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((command) =>
      command
        .setName("status")
        .setDescription("Read the finalized on-chain case state")
        .addStringOption((option) =>
          option.setName("case-id").setDescription("Case identifier").setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("appeal")
        .setDescription("Request the single permitted re-evaluation")
        .addStringOption((option) =>
          option.setName("case-id").setDescription("Case identifier").setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Why the original decision should be reconsidered")
            .setRequired(true)
            .setMaxLength(2_000),
        ),
    ),
  new ContextMenuCommandBuilder()
    .setName("Check Rule")
    .setType(ApplicationCommandType.Message)
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
].map((command) => command.toJSON());

function ruleModal(
  interaction: ChatInputCommandInteraction,
  intent: "add-rule" | "edit-rule",
): ModalBuilder {
  const ruleId = interaction.options.getString("rule-id", true);
  const mode = interaction.options.getString("mode", true);
  const action = interaction.options.getString("action", true);
  const appeal = interaction.options.getBoolean("appeal", true) ? "1" : "0";
  const modal = new ModalBuilder()
    .setCustomId(`${intent}:${ruleId}:${mode}:${action}:${appeal}`)
    .setTitle(intent === "add-rule" ? "Add server rule" : "Create new rule version");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("name")
        .setLabel("Rule name")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("text")
        .setLabel("Complete rule text")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4_000),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("detector")
        .setLabel("Detector JSON; use {} for contextual")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setValue("{}")
        .setMaxLength(4_000),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("exceptions")
        .setLabel("Exceptions JSON")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setValue("{}")
        .setMaxLength(4_000),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("scope")
        .setLabel("Scope JSON")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setValue('{"channels":["public"]}')
        .setMaxLength(4_000),
    ),
  );
  return modal;
}

function parseRuleMode(value: string): EditableRuleInput["mode"] {
  if (value === "automatic" || value === "contextual" || value === "hybrid") {
    return value;
  }
  throw new Error("Invalid rule mode");
}

function parseRuleAction(value: string): EditableRuleInput["action"] {
  if (
    value === "warn" ||
    value === "delete" ||
    value === "delete_and_warn" ||
    value === "delete_and_strike" ||
    value === "log_only"
  ) {
    return value;
  }
  throw new Error("Invalid rule action");
}

function installSummary(
  result: Awaited<ReturnType<ModerationService["installDefaultRules"]>>,
): string {
  const lines = [
    `Added: ${result.added.length ? result.added.map((id) => `\`${id}\``).join(", ") : "none"}`,
    `Updated: ${result.updated.length ? result.updated.map((id) => `\`${id}\``).join(", ") : "none"}`,
    `Unchanged: ${result.skipped.length ? result.skipped.map((id) => `\`${id}\``).join(", ") : "none"}`,
  ];
  if (result.transactionHashes.length) {
    lines.push(
      `Transactions:\n${result.transactionHashes.map((hash) => `• \`${hash}\``).join("\n")}`,
    );
  }
  return lines.join("\n").slice(0, 2_000);
}

function challengeModal(
  interaction: MessageContextMenuCommandInteraction,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(
      `challenge:${interaction.guildId}:${interaction.channelId}:${interaction.targetMessage.id}`,
    )
    .setTitle("Check against rule")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("rule-id")
          .setLabel("Rule ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(48),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Why should this message be reviewed?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2_000),
      ),
    );
}

async function handleRuleCommand(
  interaction: ChatInputCommandInteraction,
  service: ModerationService,
): Promise<void> {
  if (!interaction.guildId) throw new Error("Rule commands require a server");
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "add-rule" || subcommand === "edit-rule") {
    await interaction.showModal(ruleModal(interaction, subcommand));
    return;
  }
  await interaction.deferReply({ flags: EPHEMERAL });
  if (subcommand === "setup") {
    const displayName = interaction.options.getString("display-name", true);
    const result = await service.setupGuildWithDefaults(interaction.guildId, displayName);
    await interaction.editReply(
      `Server registration finalized: \`${result.registrationHash}\`\n${installSummary(result.defaults)}`.slice(
        0,
        2_000,
      ),
    );
    return;
  }
  if (subcommand === "install-defaults") {
    const result = await service.installDefaultRules(
      interaction.guildId,
      interaction.options.getBoolean("replace-existing") ?? false,
    );
    await interaction.editReply(installSummary(result));
    return;
  }
  if (subcommand === "list") {
    const rules = await service.listRules(interaction.guildId);
    const content = rules.length
      ? rules
          .map(
            (rule) =>
              `• \`${rule.rule_id}\` v${rule.version} — **${rule.name}** (${rule.mode}, ${rule.active ? "active" : "disabled"})`,
          )
          .join("\n")
      : "No finalized rules exist for this server.";
    await interaction.editReply(content.slice(0, 2_000));
    return;
  }
  if (subcommand === "disable-rule") {
    const ruleId = interaction.options.getString("rule-id", true);
    const hash = await service.disableRule(interaction.guildId, ruleId);
    await interaction.editReply(`Rule disable submitted: \`${hash}\``);
  }
}

async function handleCaseCommand(
  interaction: ChatInputCommandInteraction,
  service: ModerationService,
): Promise<void> {
  if (!interaction.guildId) throw new Error("Case commands require a server");
  await interaction.deferReply({ flags: EPHEMERAL });
  const subcommand = interaction.options.getSubcommand();
  const caseId = interaction.options.getString("case-id", true);
  if (subcommand === "status") {
    const item = await service.getCase(caseId);
    await interaction.editReply(
      `Case \`${item.case_id}\`\nDecision: \`${item.decision}\`\nStatus: \`${item.status}\`\nRule: \`${item.rule_id}\` v${item.rule_version}\n${item.analysis}`.slice(
        0,
        2_000,
      ),
    );
    return;
  }
  const reason = interaction.options.getString("reason", true);
  const hash = await service.appealCase(interaction.guildId, caseId, reason);
  await interaction.editReply(`Appeal submitted: \`${hash}\``);
}

async function handleModal(
  interaction: ModalSubmitInteraction,
  service: ModerationService,
): Promise<void> {
  if (!interaction.guildId) throw new Error("This action requires a server");
  const parts = interaction.customId.split(":");
  if (parts[0] === "add-rule" || parts[0] === "edit-rule") {
    const [, ruleId, mode, action, appeal] = parts;
    if (!ruleId || !mode || !action || !appeal) throw new Error("Invalid rule form");
    const parsedMode = parseRuleMode(mode);
    const parsedAction = parseRuleAction(action);
    await interaction.deferReply({ flags: EPHEMERAL });
    const input: EditableRuleInput = {
      ruleId,
      mode: parsedMode,
      action: parsedAction,
      appealAllowed: appeal === "1",
      name: interaction.fields.getTextInputValue("name"),
      text: interaction.fields.getTextInputValue("text"),
      detectorJson: interaction.fields.getTextInputValue("detector"),
      exceptionsJson: interaction.fields.getTextInputValue("exceptions"),
      scopeJson: interaction.fields.getTextInputValue("scope"),
    };
    const hash =
      parts[0] === "add-rule"
        ? await service.addRule(interaction.guildId, input)
        : await service.updateRule(interaction.guildId, input);
    await interaction.editReply(
      `Rule ${parts[0] === "add-rule" ? "creation" : "update"} submitted: \`${hash}\``,
    );
    return;
  }
  if (parts[0] === "challenge") {
    const [, guildId, channelId, messageId] = parts;
    if (!guildId || !channelId || !messageId || guildId !== interaction.guildId) {
      throw new Error("Invalid challenge form");
    }
    await interaction.deferReply({ flags: EPHEMERAL });
    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !("messages" in channel)) {
      throw new Error("The challenged message channel is unavailable");
    }
    const message = await channel.messages.fetch(messageId);
    const result = await service.openAndAdjudicateCase(
      message,
      interaction.fields.getTextInputValue("rule-id"),
      interaction.fields.getTextInputValue("reason"),
    );
    await interaction.editReply(
      `Case \`${result.caseId}\` opened. Transaction: \`${result.openTransactionHash}\``,
    );
  }
}

export async function handleInteraction(
  interaction: Interaction,
  service: ModerationService,
): Promise<void> {
  if (interaction.isMessageContextMenuCommand()) {
    await interaction.showModal(challengeModal(interaction));
    return;
  }
  if (interaction.isModalSubmit()) {
    await handleModal(interaction, service);
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "rule") {
    await handleRuleCommand(interaction, service);
  } else if (interaction.commandName === "case") {
    await handleCaseCommand(interaction, service);
  }
}
