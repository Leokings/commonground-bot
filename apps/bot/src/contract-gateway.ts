import { ruleSchema, type ConstitutionRule } from "@commonground/core";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetBradbury } from "genlayer-js/chains";
import {
  TransactionHashVariant,
  TransactionStatus,
  type CalldataEncodable,
  type Hash,
} from "genlayer-js/types";
import { z } from "zod";

import type { BotConfig } from "./config.js";
import { logger } from "./logger.js";
import { inspectReceiptExecution } from "./transaction.js";

const caseSchema = z.object({
  case_id: z.string(),
  guild_key: z.string(),
  rule_id: z.string(),
  rule_version: z.number(),
  constitution_version: z.number(),
  message_hash: z.string(),
  message_text: z.string(),
  context: z.string(),
  challenge_reason: z.string(),
  author_defense: z.string(),
  decision: z.enum(["pending", "allowed", "violation", "needs_context"]),
  analysis: z.string(),
  status: z.string(),
  decision_revision: z.number(),
  appeal_count: z.number(),
  rule_snapshot: ruleSchema,
});

export type ContractCase = z.infer<typeof caseSchema>;

export interface SubmittedWrite {
  hash: string;
  functionName: string;
}

export interface ContractGateway {
  listRules(guildKey: string): Promise<ConstitutionRule[]>;
  getCase(caseId: string): Promise<ContractCase>;
  write(functionName: string, args: CalldataEncodable[]): Promise<SubmittedWrite>;
  waitForSuccess(hash: string): Promise<void>;
}

const transientReceiptErrorPatterns = [
  "unknown rpc error",
  "unexpected token '<'",
  "is not valid json",
  "fetch failed",
  "econnreset",
  "etimedout",
  "socket hang up",
  "bad gateway",
  "service unavailable",
  "gateway timeout",
  "rate limit",
  "too many requests",
];

export function isTransientReceiptError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "object" && error !== null
        ? JSON.stringify(error)
        : String(error);
  const normalized = message.toLowerCase();
  return transientReceiptErrorPatterns.some((pattern) => normalized.includes(pattern));
}

export async function retryTransientReceipt<T>(
  operation: () => Promise<T>,
  options: {
    attempts?: number;
    delayMs?: number;
    sleep?: (delayMs: number) => Promise<void>;
    onRetry?: (error: unknown, attempt: number) => void;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 6;
  const delayMs = options.delayMs ?? 2_000;
  const sleep =
    options.sleep ??
    ((duration: number) => new Promise<void>((resolve) => setTimeout(resolve, duration)));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts || !isTransientReceiptError(error)) throw error;
      options.onRetry?.(error, attempt);
      await sleep(Math.min(delayMs * attempt, 10_000));
    }
  }

  throw new Error("Receipt polling exhausted without returning a result");
}

export function createContractGateway(config: BotConfig): ContractGateway {
  const chain =
    config.genlayerNetwork === "studionet"
      ? studionet
      : config.genlayerNetwork === "testnet-bradbury"
        ? testnetBradbury
        : localnet;
  const account = createAccount(config.genlayerPrivateKey);
  const client = createClient({
    account,
    chain,
    ...(config.genlayerRpcUrl === undefined
      ? {}
      : { endpoint: config.genlayerRpcUrl }),
  });

  async function read(functionName: string, args: CalldataEncodable[]) {
    return client.readContract({
      address: config.genlayerContractAddress,
      functionName,
      args,
      jsonSafeReturn: true,
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    });
  }

  return {
    async listRules(guildKey) {
      return z.array(ruleSchema).parse(await read("list_rules", [guildKey]));
    },
    async getCase(caseId) {
      return caseSchema.parse(await read("get_case", [caseId]));
    },
    async write(functionName, args) {
      const hash = await client.writeContract({
        address: config.genlayerContractAddress,
        functionName,
        args,
        value: 0n,
      });
      return { hash: String(hash), functionName };
    },
    async waitForSuccess(hash) {
      const receipt = await retryTransientReceipt(
        () =>
          client.waitForTransactionReceipt({
            hash: hash as Hash,
            status: TransactionStatus.FINALIZED,
            interval: 4_000,
            retries: 150,
          }),
        {
          onRetry(error, attempt) {
            logger.warn(
              { error, hash, attempt },
              "transient GenLayer receipt lookup failed; retrying",
            );
          },
        },
      );
      const execution = inspectReceiptExecution(receipt);
      if (execution.outcome !== "success") {
        throw new Error(
          execution.detail ??
            `Transaction ${hash} finalized without provably successful contract execution`,
        );
      }
    },
  };
}
