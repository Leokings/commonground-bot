import { REST, Routes } from "discord.js";

import { commandDefinitions } from "./commands.js";
import { loadCommandRegistrationConfig } from "./config.js";
import { loadEnvironment } from "./environment.js";

loadEnvironment();
const requestedScope = process.argv.includes("--guild")
  ? "guild"
  : process.argv.includes("--global")
    ? "global"
    : undefined;
const config = loadCommandRegistrationConfig(
  requestedScope
    ? { ...process.env, DISCORD_COMMAND_SCOPE: requestedScope }
    : process.env,
);
const rest = new REST({ version: "10" }).setToken(config.discordToken);

const route =
  config.commandScope === "global"
    ? Routes.applicationCommands(config.discordClientId)
    : Routes.applicationGuildCommands(
        config.discordClientId,
        config.discordTestGuildId!,
      );

await rest.put(route, { body: commandDefinitions });

process.stdout.write(
  config.commandScope === "global"
    ? `Registered ${commandDefinitions.length} CommonGround commands globally.\n`
    : `Registered ${commandDefinitions.length} CommonGround commands in test guild ${config.discordTestGuildId}.\n`,
);
