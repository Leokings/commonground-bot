import { describe, expect, it } from "vitest";

import { inspectReceiptExecution } from "./transaction.js";

describe("inspectReceiptExecution", () => {
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

