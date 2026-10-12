import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotConfig } from "./config.js";

const rpc = vi.hoisted(() => ({ readContract: vi.fn(), writeContract: vi.fn(), getTransaction: vi.fn() }));
vi.mock("genlayer-js", async (original) => ({ ...(await original<typeof import("genlayer-js")>()), createClient: () => rpc }));
import { createContractGateway } from "./contract-gateway.js";

const config = { genlayerPrivateKey: `0x${"11".repeat(32)}`, genlayerNetwork: "studionet",
  genlayerContractAddress: `0x${"22".repeat(20)}`, registryAddress: `0x${"33".repeat(20)}`,
  ledgerAddress: `0x${"44".repeat(20)}` } as BotConfig;

describe("v2 gateway integration boundaries", () => {
  beforeEach(() => { vi.clearAllMocks(); rpc.writeContract.mockResolvedValue(`0x${"12".repeat(32)}`); });
  it("keeps a pending legacy adjudication on its original contract after a v2 rollout", async () => {
    await createContractGateway(config).write("adjudicate_case", ["case-legacy-report"]);
    expect(rpc.readContract).not.toHaveBeenCalled();
    expect(rpc.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      address: "0x01858Aad8C071fE3677588C6d3b107da47d879C8", args: ["case-legacy-report"],
    }));
  });
  it("pins the expected revision for a new v2 adjudication", async () => {
    rpc.readContract.mockResolvedValue({ decision_revision: 2 });
    const caseId = `case-${"a".repeat(64)}`;
    await createContractGateway(config).write("adjudicate_case", [caseId]);
    expect(rpc.writeContract).toHaveBeenCalledWith(expect.objectContaining({ address: config.genlayerContractAddress, args: [caseId, 2] }));
  });
  it("recognizes a finalized SDK receipt and still rejects a finalized rollback", async () => {
    rpc.getTransaction.mockResolvedValue({ status: 7, statusName: "FINALIZED", consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] } });
    expect(await createContractGateway(config).isFinalizedSuccess!("0xreceipt")).toBe(true);
    rpc.getTransaction.mockResolvedValue({ status: 7, statusName: "FINALIZED", consensus_data: { leader_receipt: [{ execution_result: "ERROR", result: { payload: "[EXPECTED] Denied" } }] } });
    await expect(createContractGateway(config).isFinalizedSuccess!("0xreceipt")).rejects.toThrow("[EXPECTED] Denied");
  });
});
