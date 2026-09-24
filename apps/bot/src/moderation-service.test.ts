import { DEFAULT_RULES, type ConstitutionRule } from "@commonground/core";
import type { Client } from "discord.js";
import { describe, expect, it } from "vitest";

import type { BotConfig } from "./config.js";
import type {
  ContractCase,
  ContractGateway,
  SubmittedWrite,
} from "./contract-gateway.js";
import { ModerationService } from "./moderation-service.js";
import { MemoryOperationStore } from "./operation-store.js";

class RecordingGateway implements ContractGateway {
  readonly writes: Array<{ functionName: string; args: unknown[] }> = [];
  rules: ConstitutionRule[] = [];

  async listRules(): Promise<ConstitutionRule[]> {
    return this.rules;
  }

  async getCase(): Promise<ContractCase> {
    throw new Error("not needed by this test");
  }

  async write(functionName: string, args: unknown[]): Promise<SubmittedWrite> {
    this.writes.push({ functionName, args });
    return {
      hash: `0x${String(this.writes.length).padStart(64, "0")}`,
      functionName,
    };
  }

  async waitForSuccess(): Promise<void> {}
}

const config = {
  discordToken: "test",
  discordClientId: "1",
  discordTestGuildId: "2",
  monitoredChannelIds: new Set<string>(),
  genlayerPrivateKey: `0x${"11".repeat(32)}`,
  genlayerNetwork: "studionet",
  genlayerContractAddress: `0x${"22".repeat(20)}`,
  autoSubmitHybrid: true,
  port: 8_080,
} as BotConfig;

function service(gateway: RecordingGateway): ModerationService {
  return new ModerationService(
    {} as Client,
    config,
    gateway,
    new MemoryOperationStore(),
  );
}

function storedRule(ruleId: string): ConstitutionRule {
  const input = DEFAULT_RULES.find((rule) => rule.ruleId === ruleId);
  if (!input) throw new Error(`Unknown starter rule ${ruleId}`);
  return {
    guild_key: "sha256:guild",
    rule_id: input.ruleId,
    version: 1,
    constitution_version: 1,
    name: input.name,
    text: input.text,
    mode: input.mode,
    detector_json: input.detectorJson,
    exceptions_json: input.exceptionsJson,
    scope_json: input.scopeJson,
    action: input.action,
    appeal_allowed: input.appealAllowed,
    active: true,
    created_at: "2026-09-24T00:00:00Z",
    updated_at: "2026-09-24T00:00:00Z",
  };
}

describe("starter rule installation", () => {
  it("installs every missing default sequentially", async () => {
    const gateway = new RecordingGateway();
    const result = await service(gateway).installDefaultRules("guild-1", false);

    expect(result.added).toEqual(DEFAULT_RULES.map((rule) => rule.ruleId));
    expect(result.updated).toEqual([]);
    expect(result.transactionHashes).toHaveLength(DEFAULT_RULES.length);
    expect(gateway.writes.map((write) => write.functionName)).toEqual(
      DEFAULT_RULES.map(() => "add_rule"),
    );
  });

  it("preserves customized rules unless replacement is requested", async () => {
    const gateway = new RecordingGateway();
    gateway.rules = [storedRule("no-profanity")];

    const preserved = await service(gateway).installDefaultRules("guild-1", false);
    expect(preserved.skipped).toContain("no-profanity");
    expect(gateway.writes.some((write) => write.functionName === "update_rule")).toBe(
      false,
    );

    gateway.writes.length = 0;
    const replaced = await service(gateway).installDefaultRules("guild-1", true);
    expect(replaced.updated).toContain("no-profanity");
    expect(gateway.writes[0]?.functionName).toBe("update_rule");
  });
});
