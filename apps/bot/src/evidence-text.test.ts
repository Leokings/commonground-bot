import { describe, expect, it } from "vitest";
import { assertEvidenceText, evidenceExcerpt } from "./evidence-text.js";

describe("public evidence byte limits", () => {
  it("preserves valid exact evidence and clips excerpts without corrupting Unicode", () => {
    const original = "  Cafe\u0301 😀  ";
    expect(evidenceExcerpt(original, 100)).toBe(original);
    expect(evidenceExcerpt("é😀z", 5)).toBe("é");
    expect(evidenceExcerpt("é😀z", 6)).toBe("é😀");
    const excerpt = evidenceExcerpt("😀".repeat(2_500), 8_000);
    expect(Buffer.byteLength(excerpt)).toBe(8_000);
    expect(excerpt).not.toContain("\ufffd");
  });

  it("rejects oversized or blank evidence before submission instead of changing its hash", () => {
    expect(() => assertEvidenceText("😀".repeat(1_001), 4_000)).toThrow("4000 UTF-8 bytes");
    expect(() => assertEvidenceText("   ", 2_000)).toThrow("must contain text");
    expect(() => assertEvidenceText("😀".repeat(1_000), 4_000)).not.toThrow();
  });
});
