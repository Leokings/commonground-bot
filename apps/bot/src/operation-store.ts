import { Pool } from "pg";

export type OperationKind =
  | "register_guild"
  | "add_rule"
  | "disable_rule"
  | "open_case"
  | "adjudicate_case"
  | "appeal_case";

export type OperationStatus = "submitted" | "finalized" | "failed";

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
  saveCaseBinding(binding: CaseBinding): Promise<void>;
  getCaseBinding(caseId: string): Promise<CaseBinding | null>;
  recordStrike(
    eventId: string,
    guildId: string,
    authorId: string,
    ruleId: string,
  ): Promise<number>;
}

export class MemoryOperationStore implements OperationStore {
  readonly #operations = new Map<string, StoredOperation>();
  readonly #cases = new Map<string, CaseBinding>();
  readonly #strikes = new Map<string, { guildId: string; authorId: string; ruleId: string }>();

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

  async saveCaseBinding(binding: CaseBinding): Promise<void> {
    if (this.#cases.has(binding.caseId)) return;
    this.#cases.set(binding.caseId, { ...binding });
  }

  async getCaseBinding(caseId: string): Promise<CaseBinding | null> {
    return this.#cases.get(caseId) ?? null;
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
        action TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS commonground_strikes (
        event_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS commonground_strikes_member_idx
        ON commonground_strikes (guild_id, author_id);
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

  async saveCaseBinding(binding: CaseBinding): Promise<void> {
    await this.#pool.query(
      `INSERT INTO commonground_case_bindings
        (case_id, guild_id, channel_id, message_id, author_id, message_hash, rule_id, action)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
    }>(
      `SELECT case_id, guild_id, channel_id, message_id, author_id,
              message_hash, rule_id, action
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
        }
      : null;
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
}

export function createOperationStore(databaseUrl?: string): OperationStore {
  return databaseUrl
    ? new PostgresOperationStore(databaseUrl)
    : new MemoryOperationStore();
}
