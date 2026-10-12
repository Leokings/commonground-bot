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

/** V2 hashes exact UTF-8 bytes, including whitespace and Unicode form. */
export function hashExactText(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export function frameEvidence(values: readonly string[]): string {
  return values.map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`).join("");
}

export function evidenceDigest(values: readonly string[]): string {
  return hashExactText(frameEvidence(["CommonGroundEvidenceV2", ...values]));
}

export function moderationCaseId(guildKey: string, messageKey: string, ruleId: string,
  version: number, messageHash: string): string {
  return `case-${createHash("sha256").update(
    [guildKey, messageKey, ruleId, String(version), messageHash].join("|"),
  ).digest("hex")}`;
}

