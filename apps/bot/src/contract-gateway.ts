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
import { keccak256, parseEventLogs } from "viem";

import type { BotConfig } from "./config.js";
import { logger } from "./logger.js";
import { FinalizedExecutionError, inspectReceiptExecution } from "./transaction.js";
import type { BroadcastRecord } from "./operation-store.js";
import { contractAddressArgument } from "./calldata-address.js";

const finalizedDecisionSchema = z.enum(["allowed", "violation", "needs_context"]);
const decisionRecordSchema = z.object({
  revision: z.number().int().positive(),
  kind: z.enum(["initial", "context", "appeal"]),
  decision: finalizedDecisionSchema,
  analysis: z.string(),
  analysis_provenance: z.string(),
  decided_at: z.string(),
  appeal_reason: z.string().optional(),
});

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
  decision: z.union([z.literal("pending"), finalizedDecisionSchema]),
  analysis: z.string(),
  status: z.string(),
  decision_revision: z.number(),
  appeal_count: z.number(),
  decision_history: z.array(decisionRecordSchema),
  rule_snapshot: ruleSchema,
  defense_deadline: z.number().optional(),
  context_deadline: z.number().optional(),
  appeal_deadline: z.number().optional(),
  enforce_after: z.number().optional(),
  evidence_digest: z.string().optional(),
  extra_context: z.string().optional(),
  context_count: z.number().optional(),
});

export type ContractCase = z.infer<typeof caseSchema>;

export interface SubmittedWrite {
  hash: string;
  functionName: string;
}

export interface ContractGateway {
  relayerAddress?: string;
  protocol?: 2;
  listRules(guildKey: string): Promise<ConstitutionRule[]>;
  getCase(caseId: string): Promise<ContractCase>;
  write(functionName: string, args: CalldataEncodable[], beforeBroadcast?: (raw: `0x${string}`, hash: `0x${string}`) => Promise<void>): Promise<SubmittedWrite>;
  waitForSuccess(hash: string): Promise<void>;
  isFinalizedSuccess?(hash: string): Promise<boolean>;
  recoverBroadcast?(record: BroadcastRecord): Promise<string | null>;
  readPublic?(method: string, args: CalldataEncodable[], target?: "court" | "registry" | "ledger"): Promise<unknown>;
  verifyDeployment?(): Promise<void>;
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

  const legacy = "0x01858Aad8C071fE3677588C6d3b107da47d879C8" as const;
  const isV2Case = (caseId: unknown) => typeof caseId === "string" && /^case-[0-9a-f]{64}$/.test(caseId);
  async function read(functionName: string, args: CalldataEncodable[], address = config.genlayerContractAddress) {
    return client.readContract({
      address,
      functionName,
      args,
      jsonSafeReturn: true,
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    });
  }

  return {
    relayerAddress: account.address,
    ...(config.registryAddress ? { protocol: 2 as const } : {}),
    async listRules(guildKey) {
      return z.array(ruleSchema).parse(await read("list_rules", [guildKey], config.registryAddress ?? config.genlayerContractAddress));
    },
    async getCase(caseId) {
      return caseSchema.parse(await read("get_case", [caseId], config.registryAddress && !isV2Case(caseId) ? legacy : config.genlayerContractAddress));
    },
    async write(functionName, args, beforeBroadcast) {
      let address = config.genlayerContractAddress;
      let callArgs = [...args];
      if (config.registryAddress && ["register_guild", "add_rule", "update_rule", "disable_rule"].includes(functionName)) {
        address = config.registryAddress;
        if (functionName === "register_guild" && callArgs.length === 2) callArgs.push(config.adminAddress!);
        if (functionName === "register_guild") callArgs[2] = contractAddressArgument(callArgs[2]);
        if (functionName === "update_rule" || functionName === "disable_rule") {
          const rule = await read("get_rule", [args[0]!, args[1]!, 0], address) as { version: number };
          callArgs.push(rule.version);
        }
      }
      if (config.registryAddress && functionName === "adjudicate_case") {
        const item = await read("get_case", [args[0]!]) as { decision_revision: number };
        callArgs.push(item.decision_revision);
      }
      if (config.registryAddress && functionName === "appeal_case") {
        if (!isV2Case(args[1])) address = legacy;
        else {
          const item = await read("get_case", [args[1]!]) as { decision_revision: number };
          callArgs.push(item.decision_revision);
        }
      }
      if (functionName === "record_enforcement" && config.ledgerAddress) address = config.ledgerAddress;
      let signed = false;
      const guardedAccount = { ...account, signTransaction: async (...parameters: Parameters<typeof account.signTransaction>) => {
        if (signed) throw new Error("A second signature requires explicit reconciliation");
        const raw = await account.signTransaction(...parameters);
        if (beforeBroadcast) await beforeBroadcast(raw, keccak256(raw));
        signed = true;
        return raw;
      }};
      const hash = await client.writeContract({
        account: guardedAccount,
        address,
        functionName,
        args: callArgs,
        value: 0n,
      });
      return { hash: String(hash), functionName };
    },
    async recoverBroadcast(record) {
      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash: record.evmHash });
      } catch {
        // Exactly the persisted bytes: never sign a replacement or obtain a new nonce.
        await client.sendRawTransaction({ serializedTransaction: record.raw }).catch(() => undefined);
        return null;
      }
      if (receipt.status === "reverted") throw new FinalizedExecutionError("Persisted EVM submission reverted");
      const events = parseEventLogs({ abi: chain.consensusMainContract!.abi, logs: receipt.logs, strict: false });
      for (const event of events) {
        const item = event as unknown as { eventName: string; args: { txId?: string } };
        if (item.eventName === "NewTransaction" || item.eventName === "CreatedTransaction") return item.args.txId ?? null;
      }
      // Studio RPC can use the submission hash as its transaction id.
      if (chain.isStudio) return record.evmHash;
      return null;
    },
    async readPublic(method, args, target = "court") {
      const allowed = ["get_case", "list_cases", "get_enforcement", "get_decision", "list_decisions", "get_guild", "get_contracts", "get_source"];
      if (!allowed.includes(method)) throw new Error("Read method not allowed");
      const address = target === "registry" ? config.registryAddress : target === "ledger" ? config.ledgerAddress : config.genlayerContractAddress;
      if (!address) throw new Error("Companion is not configured");
      return read(method, args, address);
    },
    async verifyDeployment() {
      if (!config.registryAddress) return;
      const refs = await read("get_contracts", []) as { registry: string; ledger: string; protocol: number };
      const source = await read("get_source", [], config.ledgerAddress) as string;
      if (refs.protocol !== 2 || refs.registry.toLowerCase() !== config.registryAddress.toLowerCase() || refs.ledger.toLowerCase() !== config.ledgerAddress!.toLowerCase() || source.toLowerCase() !== config.genlayerContractAddress.toLowerCase()) {
        throw new Error("V2 companion binding mismatch");
      }
    },
    async isFinalizedSuccess(hash) {
      const receipt = await client.getTransaction({ hash: hash as Hash });
      if (String(receipt.status).toUpperCase() !== "FINALIZED" && String((receipt as unknown as { status_name?: string }).status_name).toUpperCase() !== "FINALIZED") return false;
      const execution = inspectReceiptExecution(receipt);
      if (execution.outcome === "failure") throw new FinalizedExecutionError(execution.detail ?? "Finalized execution failed");
      return execution.outcome === "success";
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
        if (execution.outcome === "failure") throw new FinalizedExecutionError(execution.detail ?? "Finalized contract execution failed");
        throw new Error(
          execution.detail ??
            `Transaction ${hash} finalized without provably successful contract execution`,
        );
      }
    },
  };
}
