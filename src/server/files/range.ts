/**
 * HTTP byte-range parsing (RFC 9110 §14) for the file download route.
 * Browsers need `206 Partial Content` to let a video be seeked or resumed.
 *
 * Only a single range is honoured; several ranges in one header are answered
 * with the whole file, which the RFC allows.
 */
export type ByteRange =
  | { kind: "none" } // no (usable) Range header: serve the whole file with 200
  | { kind: "partial"; start: number; end: number } // inclusive, already clamped to the file
  | { kind: "unsatisfiable" }; // 416

export function parseByteRange(header: string | null | undefined, size: number): ByteRange {
  if (!header) return { kind: "none" };
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!match) return { kind: "none" }; // other units, several ranges, garbage
  const [, rawStart = "", rawEnd = ""] = match;
  if (rawStart === "" && rawEnd === "") return { kind: "none" };
  if (size <= 0) return { kind: "unsatisfiable" };

  if (rawStart === "") {
    // suffix: the last N bytes
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start)) return { kind: "none" };
  if (rawEnd !== "") {
    const requestedEnd = Number(rawEnd);
    // syntactically invalid (start after end): ignore the header
    if (!Number.isSafeInteger(requestedEnd) || start > requestedEnd) return { kind: "none" };
  }
  if (start >= size) return { kind: "unsatisfiable" };
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  return { kind: "partial", start, end };
}
