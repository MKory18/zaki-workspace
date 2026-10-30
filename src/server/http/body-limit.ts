/**
 * Reading a request body with a ceiling (security review D2).
 *
 * `await req.text()` holds whatever the caller sent in memory, and only afterwards can any check
 * refuse it. The n8n inbound webhook is reachable WITHOUT a session: one request of a few hundred
 * megabytes — sent before any signature is checked, because the signature is over the body — was
 * enough to exhaust the container's memory, with no secret needed. This reads the stream chunk by
 * chunk and stops at `maxBytes`, and returns the same text `req.text()` would have returned.
 */

export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super("body_too_large");
    this.name = "BodyTooLargeError";
  }
}

/** The body as UTF-8 text, refusing (BodyTooLargeError) anything bigger than `maxBytes`. */
export async function readTextLimited(req: Request, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBytesLimited(req, maxBytes));
}

/** The body as bytes, refusing (BodyTooLargeError) anything bigger than `maxBytes`. */
export async function readBytesLimited(req: Request, maxBytes: number): Promise<Uint8Array> {
  // a declared length is a hint only: it can be missing or a lie, so the stream is counted too
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);
  if (!req.body) return new Uint8Array(0);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new BodyTooLargeError(maxBytes);
      chunks.push(value);
    }
  } finally {
    // the rest of the stream is not read: release it instead of leaving the socket open
    reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/**
 * An upload's form, read with a ceiling. `await req.formData()` parses whatever arrived, and a route
 * handler has no body limit of its own: a member could post gigabytes and the container held them
 * all before the per-kind check could refuse (security review D2). The bytes are read once, bounded,
 * and the SAME multipart body is then parsed — the route still sees one form.
 */
export async function readFormDataLimited(req: Request, maxBytes: number): Promise<FormData> {
  const contentType = req.headers.get("content-type") ?? "";
  const bytes = await readBytesLimited(req, maxBytes);
  // a fresh copy types as Uint8Array<ArrayBuffer>, which is what a Request body accepts
  const body = new Blob([new Uint8Array(bytes)]);
  return new Request(req.url, { method: "POST", headers: { "content-type": contentType }, body }).formData();
}
