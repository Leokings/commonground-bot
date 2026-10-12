import { CalldataAddress } from "genlayer-js/types";
import { hexToBytes } from "viem";

/** Python Address arguments require the calldata address tag, not a JSON string. */
export function contractAddressArgument(value: unknown): CalldataAddress {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error("A valid public wallet address is required before submitting this transaction");
  }
  return new CalldataAddress(hexToBytes(value as `0x${string}`));
}
