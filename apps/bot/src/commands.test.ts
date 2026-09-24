import { describe, expect, it } from "vitest";

import { commandDefinitions } from "./commands.js";

describe("Discord command definitions", () => {
  it("registers rule, case, and message-context commands", () => {
    expect(commandDefinitions.map((command) => command.name)).toEqual([
      "rule",
      "case",
      "Check Rule",
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
});
