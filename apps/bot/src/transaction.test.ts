import { describe, expect, it } from "vitest";

import { hasFinalizedStatus, inspectReceiptExecution } from "./transaction.js";

describe("inspectReceiptExecution", () => {
  it("recognizes the actual StudioNet SDK finality fields without treating accepted as finalized", () => {
    expect(hasFinalizedStatus({ status: 7, statusName: "FINALIZED" })).toBe(true);
    expect(hasFinalizedStatus({ status_name: "FINALIZED" })).toBe(true);
    expect(hasFinalizedStatus({ status: "FINALIZED" })).toBe(true);
    expect(hasFinalizedStatus({ status: 7 })).toBe(true);
    expect(hasFinalizedStatus({ status: 6, statusName: "ACCEPTED" })).toBe(false);
  });

  it("keeps conflicting execution receipts unresolved instead of trusting any success", () => {
    expect(inspectReceiptExecution({ consensus_data: { leader_receipt: [
      { execution_result: "SUCCESS" }, { execution_result: "ERROR" },
    ] }}).outcome).toBe("unknown");
    expect(inspectReceiptExecution({ consensus_data: { leader_receipt: [
      { execution_result: "ERROR", result: { status: "rollback", payload: "[EXPECTED] Permission denied" } },
    ] }})).toEqual({ outcome: "failure", detail: "[EXPECTED] Permission denied" });
  });

  it("ignores cancelled idle validators mixed into StudioNet's leader receipt array", () => {
    expect(inspectReceiptExecution({ consensus_data: { leader_receipt: [
      { mode: "leader", execution_result: "SUCCESS" },
      { mode: "validator", execution_result: "ERROR", result: { status: "contract_error", payload: "idle" } },
    ] }})).toEqual({ outcome: "success" });
  });

  it("cannot replace a failed leader execution with a validator's success", () => {
    expect(inspectReceiptExecution({ consensus_data: { leader_receipt: [
      { mode: "leader", execution_result: "ERROR", result: { payload: "[EXPECTED] Denied" } },
      { mode: "validator", execution_result: "SUCCESS" },
    ] }})).toEqual({ outcome: "failure", detail: "[EXPECTED] Denied" });
  });
  it("recognizes top-level successful execution", () => {
    expect(
      inspectReceiptExecution({ txExecutionResultName: "FINISHED_WITH_RETURN" }),
    ).toEqual({ outcome: "success" });
  });

  it("does not mistake finality for execution success", () => {
    expect(inspectReceiptExecution({ statusName: "FINALIZED" })).toEqual({
      outcome: "unknown",
    });
  });

  it("extracts execution failure details", () => {
    expect(
      inspectReceiptExecution({
        tx_execution_result_name: "FINISHED_WITH_ERROR",
        genvm_result: { error_description: "contract reverted" },
      }),
    ).toEqual({ outcome: "failure", detail: "contract reverted" });
  });

  it("supports leader receipt variants", () => {
    expect(
      inspectReceiptExecution({
        consensus_data: {
          leader_receipt: [{ execution_result: "SUCCESS" }],
        },
      }),
    ).toEqual({ outcome: "success" });
  });
});

