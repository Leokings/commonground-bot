import { Routes, type REST } from "discord.js";
import { commandDefinitions } from "./commands.js";

export async function syncCommands(rest: Pick<REST, "put">, clientId: string, testGuildId?: string): Promise<void> {
  await rest.put(Routes.applicationCommands(clientId), { body: commandDefinitions });
  if (testGuildId) {
    // Guild overrides duplicate context-menu commands alongside global ones.
    // The production bot uses one global command set for every server.
    await rest.put(Routes.applicationGuildCommands(clientId, testGuildId), { body: [] });
  }
}
