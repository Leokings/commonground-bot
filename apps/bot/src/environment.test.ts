import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { getEnvironmentPaths } from "./environment.js";

describe("environment loading", () => {
  it("includes the repository root env when launched from the bot workspace", () => {
    const repositoryRoot = path.resolve("C:/workspace/commonground-bot");
    const workspace = path.join(repositoryRoot, "apps", "bot");
    const moduleUrl = pathToFileURL(
      path.join(workspace, "src", "environment.ts"),
    ).href;

    expect(getEnvironmentPaths(workspace, moduleUrl)).toContain(
      path.join(repositoryRoot, ".env"),
    );
  });
});
