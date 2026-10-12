export type ReceiptExecution = {
  outcome: "success" | "failure" | "unknown";
  detail?: string;
};

type UnknownRecord = Record<string, unknown>;

/** Only this error proves finalized execution failed. All other polling errors are unknown. */
export class FinalizedExecutionError extends Error {}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function firstString(source: UnknownRecord | null, ...keys: string[]): string {
  if (!source) return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function leaderReceipts(receipt: UnknownRecord): UnknownRecord[] {
  const consensus = record(receipt.consensus_data) ?? record(receipt.consensusData);
  if (!consensus) return [];
  const raw = consensus.leader_receipt ?? consensus.leaderReceipt;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.map(record).filter((value): value is UnknownRecord => Boolean(value))
    .filter((value) => value.mode === undefined || value.mode === "leader");
}

function failureDetail(receipt: UnknownRecord): string | undefined {
  const genvm = record(receipt.genvm_result) ?? record(receipt.genvmResult);
  return (
    firstString(genvm, "error_description", "errorDescription", "stderr", "error_code") ||
    firstString(record(receipt.result), "payload") ||
    undefined
  );
}

export function hasFinalizedStatus(value: unknown): boolean {
  const receipt = record(value);
  if (!receipt) return false;
  const named = firstString(receipt, "statusName", "status_name", "status").toUpperCase();
  return named ? named === "FINALIZED" : receipt.status === 7;
}

/** Decode only the bounded UserError payload, never an RPC's full state snapshot. */
export function expectedReadRevert(value: unknown): string | undefined {
  let current = record(value);
  for (let depth = 0; current && depth < 4; depth += 1) {
    const message = firstString(current, "message");
    if (message === "[EXPECTED] Case does not exist" || message.endsWith(": [EXPECTED] Case does not exist")) return "[EXPECTED] Case does not exist";
    const receipt = record(record(current.data)?.receipt);
    const encoded = receipt?.result;
    if (typeof encoded === "string" && encoded.length < 4096 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      const bytes = Buffer.from(encoded, "base64");
      const reason = bytes.subarray(1).toString("utf8");
      if (bytes[0] === 1 && reason.startsWith("[EXPECTED] ")) return reason;
    }
    current = record(current.cause);
  }
  return undefined;
}

export function inspectReceiptExecution(value: unknown): ReceiptExecution {
  const receipt = record(value);
  if (!receipt) return { outcome: "unknown" };
  const topLevel = firstString(
    receipt,
    "txExecutionResultName",
    "tx_execution_result_name",
  ).toUpperCase();
  if (topLevel === "FINISHED_WITH_RETURN" || topLevel === "SUCCESS") {
    return { outcome: "success" };
  }
  if (["FINISHED_WITH_ERROR", "ERROR", "FAILURE"].includes(topLevel)) {
    return { outcome: "failure", detail: failureDetail(receipt) };
  }
  const leaders = leaderReceipts(receipt);
  const outcomes = leaders.map((leader) => firstString(leader, "execution_result", "executionResult").toUpperCase());
  if (outcomes.some((outcome) => ["SUCCESS", "FINISHED_WITH_RETURN"].includes(outcome))
      && outcomes.some((outcome) => ["ERROR", "FAILURE", "FINISHED_WITH_ERROR"].includes(outcome))) {
    return { outcome: "unknown", detail: "Mixed execution receipts require reconciliation" };
  }
  if (
    leaders.some((leader) =>
      ["SUCCESS", "FINISHED_WITH_RETURN"].includes(
        firstString(leader, "execution_result", "executionResult").toUpperCase(),
      ),
    )
  ) {
    return { outcome: "success" };
  }
  const failed = leaders.find((leader) =>
    ["ERROR", "FAILURE", "FINISHED_WITH_ERROR"].includes(
      firstString(leader, "execution_result", "executionResult").toUpperCase(),
    ),
  );
  return failed
    ? { outcome: "failure", detail: failureDetail(failed) }
    : { outcome: "unknown" };
}

