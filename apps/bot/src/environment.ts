import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

export function getEnvironmentPaths(
  cwd = process.cwd(),
  moduleUrl = import.meta.url,
): string[] {
  return [
    path.resolve(cwd, ".env"),
    fileURLToPath(new URL("../.env", moduleUrl)),
    fileURLToPath(new URL("../../../.env", moduleUrl)),
  ].filter((candidate, index, all) => all.indexOf(candidate) === index);
}

export function loadEnvironment(): void {
  for (const environmentPath of getEnvironmentPaths()) {
    loadDotenv({ path: environmentPath, override: false, quiet: true });
  }
}
