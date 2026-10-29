import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export const uploadTempDir = join(process.env.UPLOAD_DIR || join(process.cwd(), ".data", "uploads"), ".incoming");

export class UploadStreamError extends Error {
  constructor(
    public readonly kind: "empty" | "too_large" | "invalid",
    message = kind === "empty" ? "files.empty" : kind === "too_large" ? "files.too_large" : "files.invalid",
  ) {
    super(message);
    this.name = "UploadStreamError";
  }
}

export interface ReceivedUpload {
  path: string;
  name: string;
  size: number;
  prefix: Uint8Array;
  cleanup: () => Promise<void>;
}

export interface ReceiveUploadOptions {
  name: string;
  maxBytes: number;
  prefixBytes?: number;
  tempDir: string;
}

type ByteSource = AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;

function asAsyncIterable(source: ByteSource): AsyncIterable<Uint8Array> {
  if (Symbol.asyncIterator in source) return source as AsyncIterable<Uint8Array>;
  const reader = (source as ReadableStream<Uint8Array>).getReader();
  return {
    async *[Symbol.asyncIterator]() {
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) return;
          yield next.value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

export async function receiveUpload(source: ByteSource, options: ReceiveUploadOptions): Promise<ReceivedUpload> {
  const prefixLimit = Math.max(0, options.prefixBytes ?? 64 * 1024);
  const path = join(options.tempDir, `upload-${randomUUID()}.part`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let completed = false;
  try {
    await fs.mkdir(dirname(path), { recursive: true });
    handle = await fs.open(path, "wx");
    const prefixParts: Uint8Array[] = [];
    let prefixLength = 0;
    let size = 0;
    for await (const chunk of asAsyncIterable(source)) {
      if (!(chunk instanceof Uint8Array) || chunk.length === 0) continue;
      size += chunk.length;
      if (size > options.maxBytes) throw new UploadStreamError("too_large");
      if (prefixLength < prefixLimit) {
        const take = Math.min(prefixLimit - prefixLength, chunk.length);
        prefixParts.push(chunk.slice(0, take));
        prefixLength += take;
      }
      await handle.write(chunk);
    }
    await handle.close();
    handle = undefined;
    if (size === 0) throw new UploadStreamError("empty");
    completed = true;
    return {
      path,
      name: options.name,
      size,
      prefix: joinBytes(prefixParts, prefixLength),
      cleanup: async () => {
        await fs.rm(path, { force: true }).catch(() => undefined);
      },
    };
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    if (!completed) await fs.rm(path, { force: true }).catch(() => undefined);
  }
}

function joinBytes(parts: Uint8Array[], length: number): Uint8Array {
  const joined = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}
