/** Real PostgreSQL restart/lease check in a unique, isolated temporary schema. */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { loadEnvironment } from "../apps/bot/src/environment.js";
import { PostgresOperationStore } from "../apps/bot/src/operation-store.js";
import assert from "node:assert/strict";

loadEnvironment();
const connection = process.env.DATABASE_URL || process.env.POSTGRES_URI || process.env.NF_COMMONGROUND_DB_POSTGRES_URI;
if (!connection) throw new Error("A PostgreSQL connection is required");
const schema = `commonground_audit_${randomUUID().replaceAll("-", "")}`;
const admin = new Pool({ connectionString: connection, max: 1, connectionTimeoutMillis: 10_000 });
const scoped = new URL(connection);
scoped.searchParams.set("options", `-c search_path=${schema}`);
let first: PostgresOperationStore | undefined;
let restarted: PostgresOperationStore | undefined;
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  first = new PostgresOperationStore(scoped.toString());
  await first.initialize();
  const binding = { caseId: "audit-case", guildId: "audit-guild", channelId: "audit-channel",
    messageId: "audit-message", authorId: "audit-author", messageHash: "sha256:audit", ruleId: "respect",
    action: "log_only", finalizedRevision: 0, workflow: { stage: "queued" as const, args: [] } };
  assert.equal(await first.claimCase(binding), true);
  assert.equal(await first.claimCase(binding), false);
  assert.equal(await first.acquireLease("worker", "one", 60_000), true);
  assert.equal(await first.acquireLease("worker", "two", 60_000), false);
  await first.updateCaseFinalizedState(binding.caseId, 2, "allowed");
  await first.updateWorkflow(binding.caseId, { stage: "complete", args: [] });
  await first.close(); first = undefined;
  restarted = new PostgresOperationStore(scoped.toString());
  await restarted.initialize();
  const restored = await restarted.getCaseBinding(binding.caseId);
  assert.equal(restored?.finalizedRevision, 2);
  assert.equal(restored?.finalizedDecision, "allowed");
  assert.equal(restored?.workflow?.stage, "complete");
  assert.equal((await restarted.pendingCases()).length, 0);
  assert.equal(await restarted.recordStrike("audit-strike", "audit-guild", "audit-author", "respect"), 1);
  assert.equal(await restarted.recordStrike("audit-strike", "audit-guild", "audit-author", "respect"), 1);
  assert.equal(await restarted.retractStrike("audit-strike"), true);
  await restarted.releaseLease("worker", "one");
  assert.equal(await restarted.acquireLease("worker", "two", 60_000), true);
  console.log(JSON.stringify({ postgres: "passed", isolatedSchema: true,
    checks: ["idempotent case claim", "exclusive lease", "restart readback", "finalized revision", "workflow completion", "strike deduplication", "strike retraction", "lease transfer"] }));
} finally {
  await first?.close(); await restarted?.close();
  // Exact generated schema; never touches the production public schema.
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
