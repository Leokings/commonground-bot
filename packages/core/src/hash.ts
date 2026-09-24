import { createHash } from "node:crypto";

export function hashDiscordIdentifier(kind: string, value: string): string {
  if (!kind.trim() || !value.trim()) {
    throw new Error("Identifier kind and value are required");
  }
  return `sha256:${createHash("sha256").update(`${kind}:${value}`).digest("hex")}`;
}

export function hashMessageSnapshot(content: string): string {
  return `sha256:${createHash("sha256").update(content.normalize("NFC")).digest("hex")}`;
}

