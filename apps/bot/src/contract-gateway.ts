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
      const receipt = await client.waitForTransactionReceipt({
        hash: hash as Hash,
        status: TransactionStatus.FINALIZED,
        interval: 4_000,
        retries: 150,
      });
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
