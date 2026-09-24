import { REST, Routes } from "discord.js";

import { commandDefinitions } from "./commands.js";
import { loadCommandRegistrationConfig } from "./config.js";
import { loadEnvironment } from "./environment.js";

loadEnvironment();
const config = loadCommandRegistrationConfig();
const rest = new REST({ version: "10" }).setToken(config.discordToken);

await rest.put(
  Routes.applicationGuildCommands(
    config.discordClientId,
    config.discordTestGuildId,
  ),
  { body: commandDefinitions },
);

process.stdout.write(
  `Registered ${commandDefinitions.length} CommonGround commands in test guild ${config.discordTestGuildId}.\n`,
);
