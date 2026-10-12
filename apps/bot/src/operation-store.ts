import { Pool } from "pg";

export type OperationKind =
  | "register_guild"
  | "add_rule"
  | "update_rule"
  | "disable_rule"
  | "open_case"
  | "adjudicate_case"
  | "appeal_case"
  | "submit_defense"
  | "supply_context"
  | "record_enforcement"
  | "expire_case";
export type EnforcementOutcome = "applied" | "already_applied" | "partial" | "failed" | "unknown" | "withheld_changed" | "unavailable" | "no_action";
export interface BroadcastRecord {
  id: string;
  raw: `0x${string}`;
  evmHash: `0x${string}`;
  kind: OperationKind;
  guildId: string;
  caseId?: string;
}
export interface CaseWorkflow {
  args: unknown[];
  stage: "queued" | "opening" | "waiting_defense" | "reviewing" | "waiting_context" | "waiting_appeal" | "executing" | "complete" | "blocked";
  error?: string;
  hash?: string;
  actionOutcome?: EnforcementOutcome;
  actionDetail?: string;
  actionRevision?: number;
  actionStarted?: boolean;
  ledgerHash?: string;
}

export type OperationStatus = "submitted" | "finalized" | "failed";
export type FinalizedDecision = "allowed" | "violation" | "needs_context";

export interface StoredOperation {
  transactionHash: string;
  kind: OperationKind;
  guildId: string;
  caseId?: string;
  status: OperationStatus;
  error?: string;
  submittedAt: string;
  updatedAt: string;
}

export interface CaseBinding {
  caseId: string;
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  messageHash: string;
  ruleId: string;
  action: string;
  finalizedRevision: number;
  finalizedDecision?: FinalizedDecision;
  finalizedAt?: string;
  workflow?: CaseWorkflow;
}

export interface OperationStore {
  initialize(): Promise<void>;
  saveOperation(operation: StoredOperation): Promise<void>;
  updateOperation(
    transactionHash: string,
    status: OperationStatus,
    error?: string,
  ): Promise<void>;
  pendingOperations(): Promise<StoredOperation[]>;
  latestCaseOperation(caseId: string, kind: OperationKind): Promise<StoredOperation | null>;
  saveCaseBinding(binding: CaseBinding): Promise<void>;
  getCaseBinding(caseId: string): Promise<CaseBinding | null>;
  updateCaseFinalizedState(
    caseId: string,
    revision: number,
    decision: FinalizedDecision,
  ): Promise<void>;
  recordStrike(
    eventId: string,
    guildId: string,
    authorId: string,
    ruleId: string,
  ): Promise<number>;
  retractStrike(eventId: string): Promise<boolean>;
  claimCase(binding: CaseBinding): Promise<boolean>;
  updateWorkflow(caseId: string, workflow: CaseWorkflow): Promise<void>;
  pendingCases(): Promise<CaseBinding[]>;
  acquireLease(key: string, owner: string, ttlMs: number): Promise<boolean>;
  releaseLease(key: string, owner: string): Promise<void>;
  saveBroadcast(record: BroadcastRecord): Promise<void>;
  pendingBroadcasts(): Promise<BroadcastRecord[]>;
  touchBroadcast(id: string): Promise<void>;
  completeBroadcast(id: string): Promise<void>;
}

export class MemoryOperationStore implements OperationStore {
  readonly #operations = new Map<string, StoredOperation>();
  readonly #cases = new Map<string, CaseBinding>();
  readonly #strikes = new Map<string, { guildId: string; authorId: string; ruleId: string }>();
  readonly #leases = new Map<string, { owner: string; until: number }>();
  readonly #broadcasts = new Map<string, BroadcastRecord>();
  readonly #caseTouched = new Map<string, number>();
  readonly #broadcastTouched = new Map<string, number>();

  async claimCase(binding: CaseBinding): Promise<boolean> {
    if (this.#cases.has(binding.caseId)) return false;
    this.#cases.set(binding.caseId, structuredClone(binding));
    this.#caseTouched.set(binding.caseId, Date.now());
    return true;
  }
  async updateWorkflow(caseId: string, workflow: CaseWorkflow): Promise<void> {
    const binding = this.#cases.get(caseId);
    if (!binding) throw new Error("Missing case binding");
    binding.workflow = structuredClone(workflow);
    this.#caseTouched.set(caseId, Date.now());
  }
  async pendingCases(): Promise<CaseBinding[]> {
    return Array.from(this.#cases.values())
      .filter((binding) => binding.workflow && !["complete", "blocked"].includes(binding.workflow.stage))
      .sort((left, right) => (this.#caseTouched.get(left.caseId) ?? 0) - (this.#caseTouched.get(right.caseId) ?? 0))
      .map((binding) => structuredClone(binding));
  }
  async acquireLease(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const lease = this.#leases.get(key);
    if (lease && lease.until > Date.now() && lease.owner !== owner) return false;
    this.#leases.set(key, { owner, until: Date.now() + ttlMs });
    return true;
  }
  async releaseLease(key: string, owner: string): Promise<void> {
    if (this.#leases.get(key)?.owner === owner) this.#leases.delete(key);
  }
  async saveBroadcast(record: BroadcastRecord): Promise<void> { this.#broadcasts.set(record.id, { ...record }); this.#broadcastTouched.set(record.id, Date.now()); }
  async pendingBroadcasts(): Promise<BroadcastRecord[]> { return Array.from(this.#broadcasts.values()).sort((left, right) => (this.#broadcastTouched.get(left.id) ?? 0) - (this.#broadcastTouched.get(right.id) ?? 0)); }
  async touchBroadcast(id: string): Promise<void> { this.#broadcastTouched.set(id, Date.now()); }
  async completeBroadcast(id: string): Promise<void> {
    this.#broadcasts.delete(id);
    this.#broadcastTouched.delete(id);
  }

  async initialize(): Promise<void> {}

  async saveOperation(operation: StoredOperation): Promise<void> {
    if (this.#operations.has(operation.transactionHash)) return;
    this.#operations.set(operation.transactionHash, { ...operation });
  }

  async updateOperation(
    transactionHash: string,
    status: OperationStatus,
    error?: string,
  ): Promise<void> {
    const existing = this.#operations.get(transactionHash);
    if (!existing) throw new Error(`Unknown transaction ${transactionHash}`);
    this.#operations.set(transactionHash, {
      ...existing,
      status,
      ...(error === undefined ? {} : { error }),
      updatedAt: new Date().toISOString(),
    });
  }

  async pendingOperations(): Promise<StoredOperation[]> {
    return Array.from(this.#operations.values()).filter(
      (operation) => operation.status === "submitted",
    );
  }

  async latestCaseOperation(caseId: string, kind: OperationKind): Promise<StoredOperation | null> {
    const item = Array.from(this.#operations.values()).filter((operation) => operation.caseId === caseId && operation.kind === kind)
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt))[0];
    return item ? { ...item } : null;
  }

  async saveCaseBinding(binding: CaseBinding): Promise<void> {
    if (this.#cases.has(binding.caseId)) return;
    this.#cases.set(binding.caseId, { ...binding });
    this.#caseTouched.set(binding.caseId, Date.now());
  }

  async getCaseBinding(caseId: string): Promise<CaseBinding | null> {
    return this.#cases.get(caseId) ?? null;
  }

  async updateCaseFinalizedState(
    caseId: string,
    revision: number,
    decision: FinalizedDecision,
  ): Promise<void> {
    const existing = this.#cases.get(caseId);
    if (!existing) throw new Error(`Unknown case binding ${caseId}`);
    if (revision <= existing.finalizedRevision) return;
    this.#cases.set(caseId, {
      ...existing,
      finalizedRevision: revision,
      finalizedDecision: decision,
      finalizedAt: new Date().toISOString(),
    });
  }

  async recordStrike(
    eventId: string,
    guildId: string,
    authorId: string,
    ruleId: string,
  ): Promise<number> {
    if (!this.#strikes.has(eventId)) {
      this.#strikes.set(eventId, { guildId, authorId, ruleId });
    }
    return Array.from(this.#strikes.values()).filter(
      (strike) => strike.guildId === guildId && strike.authorId === authorId,
    ).length;
  }

  async retractStrike(eventId: string): Promise<boolean> {
    return this.#strikes.delete(eventId);
  }
}

export class PostgresOperationStore implements OperationStore {
  readonly #pool: Pool;

  constructor(databaseUrl: string) {
    this.#pool = new Pool({ connectionString: databaseUrl, max: 5 });
  }

  async initialize(): Promise<void> {
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS commonground_operations (
        transaction_hash TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        case_id TEXT,
        status TEXT NOT NULL,
        error TEXT,
        submitted_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS commonground_operations_status_idx
        ON commonground_operations (status);
      CREATE TABLE IF NOT EXISTS commonground_case_bindings (
        case_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        message_hash TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        action TEXT NOT NULL,
        finalized_revision INTEGER NOT NULL DEFAULT 0,
        finalized_decision TEXT,
        finalized_at TIMESTAMPTZ
      );
      ALTER TABLE commonground_case_bindings
        ADD COLUMN IF NOT EXISTS finalized_revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE commonground_case_bindings
        ADD COLUMN IF NOT EXISTS finalized_decision TEXT;
      ALTER TABLE commonground_case_bindings
        ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
      CREATE TABLE IF NOT EXISTS commonground_strikes (
        event_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS commonground_strikes_member_idx
        ON commonground_strikes (guild_id, author_id);
      ALTER TABLE commonground_case_bindings ADD COLUMN IF NOT EXISTS workflow JSONB;
      ALTER TABLE commonground_case_bindings ADD COLUMN IF NOT EXISTS workflow_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      CREATE TABLE IF NOT EXISTS commonground_leases (
        key TEXT PRIMARY KEY, owner TEXT NOT NULL, until_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS commonground_broadcasts (
        id TEXT PRIMARY KEY, payload JSONB NOT NULL, completed BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE commonground_broadcasts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);
  }

  async saveOperation(operation: StoredOperation): Promise<void> {
    await this.#pool.query(
      `INSERT INTO commonground_operations
        (transaction_hash, kind, guild_id, case_id, status, error, submitted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (transaction_hash) DO NOTHING`,
      [
        operation.transactionHash,
        operation.kind,
        operation.guildId,
        operation.caseId ?? null,
        operation.status,
        operation.error ?? null,
        operation.submittedAt,
        operation.updatedAt,
      ],
    );
  }

  async updateOperation(
    transactionHash: string,
    status: OperationStatus,
    error?: string,
  ): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE commonground_operations
       SET status = $2, error = $3, updated_at = NOW()
       WHERE transaction_hash = $1`,
      [transactionHash, status, error ?? null],
    );
    if (result.rowCount !== 1) throw new Error(`Unknown transaction ${transactionHash}`);
  }

  async pendingOperations(): Promise<StoredOperation[]> {
    const result = await this.#pool.query<{
      transaction_hash: string;
      kind: OperationKind;
      guild_id: string;
      case_id: string | null;
      status: OperationStatus;
      error: string | null;
      submitted_at: Date;
      updated_at: Date;
    }>(
      `SELECT transaction_hash, kind, guild_id, case_id, status, error,
              submitted_at, updated_at
       FROM commonground_operations
       WHERE status = 'submitted'
       ORDER BY submitted_at ASC`,
    );
    return result.rows.map((row) => ({
      transactionHash: row.transaction_hash,
      kind: row.kind,
      guildId: row.guild_id,
      status: row.status,
      submittedAt: row.submitted_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      ...(row.case_id === null ? {} : { caseId: row.case_id }),
      ...(row.error === null ? {} : { error: row.error }),
    }));
  }

  async latestCaseOperation(caseId: string, kind: OperationKind): Promise<StoredOperation | null> {
    const result = await this.#pool.query<{
      transaction_hash: string; guild_id: string; status: OperationStatus; error: string | null;
      submitted_at: Date; updated_at: Date;
    }>(`SELECT transaction_hash,guild_id,status,error,submitted_at,updated_at FROM commonground_operations
        WHERE case_id=$1 AND kind=$2 ORDER BY submitted_at DESC LIMIT 1`, [caseId, kind]);
    const row = result.rows[0];
    return row ? { transactionHash: row.transaction_hash, guildId: row.guild_id, kind,
      status: row.status, submittedAt: row.submitted_at.toISOString(), updatedAt: row.updated_at.toISOString(),
      caseId, ...(row.error === null ? {} : { error: row.error }) } : null;
  }

  async saveCaseBinding(binding: CaseBinding): Promise<void> {
    await this.#pool.query(
      `INSERT INTO commonground_case_bindings
        (case_id, guild_id, channel_id, message_id, author_id, message_hash, rule_id,
         action, finalized_revision, finalized_decision, finalized_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (case_id) DO NOTHING`,
      [
        binding.caseId,
        binding.guildId,
        binding.channelId,
        binding.messageId,
        binding.authorId,
        binding.messageHash,
        binding.ruleId,
        binding.action,
        binding.finalizedRevision,
        binding.finalizedDecision ?? null,
        binding.finalizedAt ?? null,
      ],
    );
  }

  async getCaseBinding(caseId: string): Promise<CaseBinding | null> {
    const result = await this.#pool.query<{
      case_id: string;
      guild_id: string;
      channel_id: string;
      message_id: string;
      author_id: string;
      message_hash: string;
      rule_id: string;
      action: string;
      finalized_revision: number;
      finalized_decision: FinalizedDecision | null;
      finalized_at: Date | null;
      workflow: CaseWorkflow | null;
    }>(
      `SELECT case_id, guild_id, channel_id, message_id, author_id,
              message_hash, rule_id, action, finalized_revision,
              finalized_decision, finalized_at, workflow
       FROM commonground_case_bindings
       WHERE case_id = $1`,
      [caseId],
    );
    const row = result.rows[0];
    return row
      ? {
          caseId: row.case_id,
          guildId: row.guild_id,
          channelId: row.channel_id,
          messageId: row.message_id,
          authorId: row.author_id,
          messageHash: row.message_hash,
          ruleId: row.rule_id,
          action: row.action,
          finalizedRevision: row.finalized_revision,
          ...(row.finalized_decision === null
            ? {}
            : { finalizedDecision: row.finalized_decision }),
          ...(row.finalized_at === null
            ? {}
            : { finalizedAt: row.finalized_at.toISOString() }),
          ...(row.workflow ? { workflow: row.workflow } : {}),
        }
      : null;
  }

  async updateCaseFinalizedState(
    caseId: string,
    revision: number,
    decision: FinalizedDecision,
  ): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE commonground_case_bindings
       SET finalized_revision = $2, finalized_decision = $3, finalized_at = NOW()
       WHERE case_id = $1 AND finalized_revision < $2`,
      [caseId, revision, decision],
    );
    if (result.rowCount === 1) return;
    const existing = await this.#pool.query(
      `SELECT 1 FROM commonground_case_bindings WHERE case_id = $1`,
      [caseId],
    );
    if (existing.rowCount !== 1) throw new Error(`Unknown case binding ${caseId}`);
  }

  async recordStrike(
    eventId: string,
    guildId: string,
    authorId: string,
    ruleId: string,
  ): Promise<number> {
    await this.#pool.query(
      `INSERT INTO commonground_strikes (event_id, guild_id, author_id, rule_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, guildId, authorId, ruleId],
    );
    const result = await this.#pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM commonground_strikes
       WHERE guild_id = $1 AND author_id = $2`,
      [guildId, authorId],
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async retractStrike(eventId: string): Promise<boolean> {
    const result = await this.#pool.query(
      `DELETE FROM commonground_strikes WHERE event_id = $1`,
      [eventId],
    );
    return result.rowCount === 1;
  }

  async claimCase(binding: CaseBinding): Promise<boolean> {
    const result = await this.#pool.query(
      `INSERT INTO commonground_case_bindings
       (case_id,guild_id,channel_id,message_id,author_id,message_hash,rule_id,action,finalized_revision,workflow,workflow_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW()) ON CONFLICT (case_id) DO NOTHING`,
      [binding.caseId,binding.guildId,binding.channelId,binding.messageId,binding.authorId,
       binding.messageHash,binding.ruleId,binding.action,binding.finalizedRevision,JSON.stringify(binding.workflow)],
    );
    return result.rowCount === 1;
  }
  async updateWorkflow(caseId: string, workflow: CaseWorkflow): Promise<void> {
    const result = await this.#pool.query(`UPDATE commonground_case_bindings SET workflow=$2::jsonb, workflow_updated_at=NOW() WHERE case_id=$1`, [caseId,JSON.stringify(workflow)]);
    if (result.rowCount !== 1) throw new Error("Missing case binding");
  }
  async pendingCases(): Promise<CaseBinding[]> {
    const result = await this.#pool.query<{ case_id: string }>(`SELECT case_id FROM commonground_case_bindings WHERE workflow IS NOT NULL AND workflow->>'stage' NOT IN ('complete','blocked') ORDER BY workflow_updated_at,case_id LIMIT 100`);
    const bindings = await Promise.all(result.rows.map((row) => this.getCaseBinding(row.case_id)));
    return bindings.filter((binding): binding is CaseBinding => binding !== null);
  }
  async acquireLease(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const result = await this.#pool.query(`INSERT INTO commonground_leases (key,owner,until_at) VALUES ($1,$2,NOW()+$3*INTERVAL '1 millisecond') ON CONFLICT (key) DO UPDATE SET owner=$2, until_at=NOW()+$3*INTERVAL '1 millisecond' WHERE commonground_leases.until_at<=NOW() OR commonground_leases.owner=$2`, [key,owner,ttlMs]);
    return result.rowCount === 1;
  }
  async releaseLease(key: string, owner: string): Promise<void> {
    await this.#pool.query(`DELETE FROM commonground_leases WHERE key=$1 AND owner=$2`,[key,owner]);
  }
  async saveBroadcast(record: BroadcastRecord): Promise<void> {
    await this.#pool.query(`INSERT INTO commonground_broadcasts (id,payload) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO NOTHING`,[record.id,JSON.stringify(record)]);
  }
  async pendingBroadcasts(): Promise<BroadcastRecord[]> {
    const result = await this.#pool.query<{ payload: BroadcastRecord }>(`SELECT payload FROM commonground_broadcasts WHERE NOT completed ORDER BY updated_at,id LIMIT 100`);
    return result.rows.map((row) => row.payload);
  }
  async touchBroadcast(id: string): Promise<void> { await this.#pool.query(`UPDATE commonground_broadcasts SET updated_at=NOW() WHERE id=$1 AND NOT completed`, [id]); }
  async completeBroadcast(id: string): Promise<void> {
    await this.#pool.query(`DELETE FROM commonground_broadcasts WHERE id=$1`, [id]);
  }
}

export function createOperationStore(databaseUrl?: string): OperationStore {
  return databaseUrl
    ? new PostgresOperationStore(databaseUrl)
    : new MemoryOperationStore();
}
