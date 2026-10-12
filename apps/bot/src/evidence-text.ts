/** Bound an excerpt in UTF-8 bytes without splitting a Unicode code point. */
export function evidenceExcerpt(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return value;
  let bytes = 0;
  let excerpt = "";
  for (const character of value) {
    const width = Buffer.byteLength(character, "utf8");
    if (bytes + width > maximumBytes) break;
    excerpt += character;
    bytes += width;
  }
  return excerpt;
}

export function assertEvidenceText(value: string, maximumBytes: number): void {
  if (!value.trim() || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new Error(`Public evidence must contain text and fit within ${maximumBytes} UTF-8 bytes. Shorten the text and try again; no new transaction was submitted.`);
  }
}
