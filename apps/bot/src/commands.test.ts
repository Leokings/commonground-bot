import { describe, expect, it } from "vitest";

import { commandDefinitions, parseDiscordMessageLink } from "./commands.js";

describe("Discord command definitions", () => {
  it("registers administration, member-report, and message-context commands", () => {
    expect(commandDefinitions.map((command) => command.name)).toEqual([
      "rule",
      "case",
      "report",
      "Report to CommonGround",
    ]);
  });

  it("keeps rule mutations under one administrator command", () => {
    const rule = commandDefinitions[0];
    expect(rule?.default_member_permissions).toBeDefined();
    const subcommands = rule?.options?.map((option) => option.name);
    expect(subcommands).toEqual([
      "setup",
      "install-defaults",
      "add-rule",
      "edit-rule",
      "list",
      "disable-rule",
    ]);
  });

  it("does not expose the retired constitution command", () => {
    expect(commandDefinitions.some((command) => command.name === "constitution")).toBe(false);
  });

  it("lets ordinary members report without entering a rule ID", () => {
    const report = commandDefinitions.find((command) => command.name === "report");
    expect(report?.default_member_permissions).toBeUndefined();
    expect(report?.options?.map((option) => option.name)).toEqual([
      "message-link",
      "reason",
    ]);
    expect(
      commandDefinitions.find((command) => command.name === "Report to CommonGround")
        ?.default_member_permissions,
    ).toBeUndefined();
  });

  it("accepts canonical Discord message links", () => {
    expect(
      parseDiscordMessageLink("https://discord.com/channels/123/456/789"),
    ).toEqual({ guildId: "123", channelId: "456", messageId: "789" });
    expect(parseDiscordMessageLink("https://example.com/channels/123/456/789")).toBeNull();
  });
});
