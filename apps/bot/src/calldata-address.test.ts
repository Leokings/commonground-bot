import { abi } from "genlayer-js";
import { CalldataAddress } from "genlayer-js/types";
import { describe, expect, it } from "vitest";
import { contractAddressArgument } from "./calldata-address.js";

describe("Python Address call arguments", () => {
  it("preserves the address type through the real SDK calldata codec", () => {
    const publicAddress = `0x${"12".repeat(20)}`;
    const decoded = abi.calldata.decode(abi.calldata.encode(contractAddressArgument(publicAddress)));
    expect(decoded).toBeInstanceOf(CalldataAddress);
    expect((decoded as CalldataAddress).bytes).toEqual(new Uint8Array(20).fill(0x12));
    expect(abi.calldata.decode(abi.calldata.encode(publicAddress))).toBe(publicAddress);
  });

  it("rejects missing and malformed admin addresses before signing", () => {
    expect(() => contractAddressArgument(undefined)).toThrow("public wallet address");
    expect(() => contractAddressArgument("0x123")).toThrow("public wallet address");
  });
});
