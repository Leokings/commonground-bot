import type { ConstitutionRule } from "@commonground/core";

import type { ContractGateway } from "./contract-gateway.js";

interface CacheEntry {
  rules: ConstitutionRule[];
  expiresAt: number;
}

export class RuleCache {
  readonly #entries = new Map<string, CacheEntry>();

  constructor(
    private readonly gateway: ContractGateway,
    private readonly ttlMs = 30_000,
  ) {}

  async get(guildKey: string): Promise<ConstitutionRule[]> {
    const existing = this.#entries.get(guildKey);
    if (existing && existing.expiresAt > Date.now()) return existing.rules;
    const rules = await this.gateway.listRules(guildKey);
    this.#entries.set(guildKey, { rules, expiresAt: Date.now() + this.ttlMs });
    return rules;
  }

  invalidate(guildKey: string): void {
    this.#entries.delete(guildKey);
  }
}
