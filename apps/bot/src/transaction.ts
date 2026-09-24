export type ReceiptExecution = {
  outcome: "success" | "failure" | "unknown";
  detail?: string;
};

type UnknownRecord = Record<string, unknown>;

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
  return values.map(record).filter((value): value is UnknownRecord => Boolean(value));
}

function failureDetail(receipt: UnknownRecord): string | undefined {
  const genvm = record(receipt.genvm_result) ?? record(receipt.genvmResult);
  return (
    firstString(genvm, "error_description", "errorDescription", "stderr", "error_code") ||
    undefined
  );
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

