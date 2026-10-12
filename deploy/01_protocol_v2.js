/** Invoked by `genlayer deploy`; the CLI supplies its unlocked signing wallet. */
import { readFile } from "node:fs/promises";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { DEFAULT_RULES, evidenceDigest, hashDiscordIdentifier, hashExactText, moderationCaseId } from "../packages/core/dist/index.js";
import { inspectReceiptExecution } from "../apps/bot/dist/transaction.js";
import { contractAddressArgument } from "../apps/bot/dist/calldata-address.js";

export default async function rollout(cliClient) {
  // Use the project's pinned SDK codec with the CLI's existing signing account.
  // The CLI bundles its own SDK classes, whose Address instances are distinct.
  const client = createClient({ account: cliClient.account, chain: studionet });
  const action = process.env.CG_ACTION;
  const parameters = JSON.parse(process.env.CG_ARGS ?? "[]");
  const signer = client.account?.address;
  if (!signer || signer.toLowerCase() !== process.env.CG_EXPECTED_SIGNER?.toLowerCase()) throw new Error("Select and confirm the intended CLI signing wallet first");
  if (client.chain.id !== 61999) throw new Error("This rollout helper only supports gasless StudioNet");
  const address = (value) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value ?? "")) throw new Error("Expected a public contract address");
    return value;
  };
  const read = (target, method, args = []) => client.readContract({ address: address(target), functionName: method, args, transactionHashVariant: "latest-final", jsonSafeReturn: true });
  async function finalized(hash) {
    console.log(JSON.stringify({ submitted: hash, signer }));
    const receipt = await client.waitForTransactionReceipt({ hash, status: "FINALIZED", interval: 3_000, retries: 150 });
    const execution = inspectReceiptExecution(receipt);
    const target = receipt.data?.contract_address ?? receipt.txDataDecoded?.contractAddress ?? receipt.to_address ?? receipt.recipient;
    console.log(JSON.stringify({ hash, status: receipt.status, execution, address: target }));
    if (execution.outcome !== "success") throw new Error(`Execution was not successful: ${hash}`);
    return { receipt, target };
  }
  const write = async (target, method, args) => finalized(await client.writeContract({ address: address(target), functionName: method, args, value: 0n }));
  if (action === "deploy") {
    const [name, ...companions] = parameters;
    if (!["CommunityRegistry", "EnforcementLedger", "CaseCourt"].includes(name)) throw new Error("Unknown contract");
    const code = await readFile(new URL(`../contracts/${name}.py`, import.meta.url), "utf8");
    const args = name === "CommunityRegistry" ? [contractAddressArgument(signer), JSON.stringify(DEFAULT_RULES)] : companions.map(contractAddressArgument);
    const { target } = await finalized(await client.deployContract({ code, args }));
    const remote = await client.getContractCode(address(target));
    const actual = remote.startsWith("0x") ? Buffer.from(remote.slice(2), "hex").toString("utf8") : remote;
    if (actual !== code) throw new Error("Deployed source mismatch");
    console.log(JSON.stringify({ contract: name, address: target, sourceVerified: true, sourceSha256: hashExactText(code) }));
  } else if (action === "bind") {
    const [ledger, court] = parameters;
    await write(ledger, "bind_source", [contractAddressArgument(court)]);
    console.log(JSON.stringify({ source: await read(ledger, "get_source"), companions: await read(court, "get_contracts") }));
  } else if (action === "register") {
    const [registry, guildId, admin] = parameters;
    const guild = hashDiscordIdentifier("guild", guildId);
    await write(registry, "register_guild", [guild, "Plain3rd's server", contractAddressArgument(admin)]);
    console.log(JSON.stringify({ guild: await read(registry, "get_guild", [guild]), rules: await read(registry, "list_rules", [guild]) }));
  } else if (action === "open") {
    const [court, guildId, messageId] = parameters;
    const guild = hashDiscordIdentifier("guild", guildId);
    const ruleId = "no-profanity";
    const text = "Fuck, this test is working smoothly — this is positive emphasis, not an insult.";
    const context = "Synthetic public fixture celebrating a feature release. No real user is targeted.";
    const reason = "StudioNet integration check of contextual praise and exact evidence hashing.";
    const message = hashDiscordIdentifier("message", messageId);
    const channel = hashDiscordIdentifier("channel", "synthetic-integration-channel");
    const author = hashDiscordIdentifier("author", "synthetic-integration-author");
    const messageHash = hashExactText(text);
    const caseId = moderationCaseId(guild, message, ruleId, 1, messageHash);
    const digest = evidenceDigest([guild, ruleId, "1", message, channel, author, text, context, reason]);
    await write(court, "open_case", [caseId, guild, ruleId, 1, messageHash, text, context, reason, digest, message, channel, author]);
    const item = await read(court, "get_case", [caseId]);
    if (item.evidence_digest !== digest || item.message_hash !== messageHash) throw new Error("Evidence readback mismatch");
    console.log(JSON.stringify({ caseId, evidenceVerified: true, case: item }));
  } else if (action === "roles") {
    const [registry, guildId, relayer] = parameters;
    const guild = hashDiscordIdentifier("guild", guildId);
    await write(registry, "set_roles", [guild, contractAddressArgument(relayer), contractAddressArgument(relayer), Math.floor(Date.now() / 1000) + 86400]);
    console.log(JSON.stringify({ guild: await read(registry, "get_guild", [guild]) }));
  } else if (action === "migrate-rule") {
    const [registry, legacy, guildId, ruleId] = parameters;
    const guild = hashDiscordIdentifier("guild", guildId);
    const rule = await read(legacy, "get_rule", [guild, ruleId, 0]);
    await write(registry, "add_rule", [guild, rule.rule_id, rule.name, rule.text, rule.mode,
      rule.detector_json, rule.exceptions_json, rule.scope_json, rule.action, rule.appeal_allowed]);
    console.log(JSON.stringify({ migratedRule: await read(registry, "get_rule", [guild, ruleId, 0]) }));
  } else throw new Error("Set CG_ACTION to deploy, bind, register, open, roles, or migrate-rule, with explicit CG_ARGS");
}
