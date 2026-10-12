import { Routes } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { commandDefinitions } from "./commands.js";
import { syncCommands } from "./sync-commands.js";

describe("production Discord command registration", () => {
  it("publishes one global command set and clears stale test-guild duplicates", async () => {
    const put = vi.fn(async () => undefined);
    await syncCommands({ put }, "123", "456");
    expect(put.mock.calls).toEqual([
      [Routes.applicationCommands("123"), { body: commandDefinitions }],
      [Routes.applicationGuildCommands("123", "456"), { body: [] }],
    ]);
  });
  it("works for installations without a configured test guild", async () => {
    const put = vi.fn(async () => undefined);
    await syncCommands({ put }, "123");
    expect(put).toHaveBeenCalledTimes(1);
  });
});
