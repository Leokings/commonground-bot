import { describe, expect, it, vi } from "vitest";

import {
  isTransientReceiptError,
  retryTransientReceipt,
} from "./contract-gateway.js";

describe("GenLayer receipt retrying", () => {
  it("recognizes malformed HTML RPC responses as transient", () => {
    expect(
      isTransientReceiptError(
        new Error("Unexpected token '<', \"<!DOCTYPE \" is not valid JSON"),
      ),
    ).toBe(true);
  });

  it("retries a transient lookup without resubmitting the transaction", async () => {
    const operation = vi
      .fn<() => Promise<{ status: string }>>()
      .mockRejectedValueOnce(new Error("Unknown RPC error: Bad Gateway"))
      .mockResolvedValue({ status: "FINALIZED" });
    const sleep = vi.fn(async () => undefined);

    await expect(
      retryTransientReceipt(operation, { attempts: 3, delayMs: 1, sleep }),
    ).resolves.toEqual({ status: "FINALIZED" });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not hide non-transient receipt failures", async () => {
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(
      new Error("transaction execution reverted"),
    );

    await expect(
      retryTransientReceipt(operation, {
        attempts: 3,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("transaction execution reverted");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
