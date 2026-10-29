import Busboy from "busboy";
import { receiveUpload, UploadStreamError, type ReceivedUpload } from "./upload-stream";

export interface MultipartUpload {
  upload: ReceivedUpload;
  fields: Record<string, string>;
}

export async function parseMultipartUpload(
  request: Request,
  options: { fieldName: string; maxBytes: number; tempDir: string },
): Promise<MultipartUpload> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
    throw new UploadStreamError("invalid", "files.multipart_required");
  }
  if (!request.body) throw new UploadStreamError("empty");

  const fields: Record<string, string> = {};
  let upload: ReceivedUpload | undefined;
  let failure: unknown;
  const pendingFiles: Promise<void>[] = [];
  const parser = Busboy({
    headers: { "content-type": contentType },
    defParamCharset: "utf8",
    limits: { files: 1, fields: 8, fileSize: options.maxBytes + 1 },
  });
  const done = new Promise<void>((resolve, reject) => {
    parser.on("field", (name, value) => {
      fields[name] = value;
    });
    parser.on("file", (name, stream, info) => {
      if (name !== options.fieldName || upload || pendingFiles.length > 0) {
        stream.resume();
        failure ??= new UploadStreamError("empty");
        return;
      }
      const pending = receiveUpload(stream, {
        name: info.filename,
        maxBytes: options.maxBytes + 1,
        tempDir: options.tempDir,
      })
        .then(async (received) => {
          upload = received;
          if (stream.truncated || received.size > options.maxBytes) {
            failure = new UploadStreamError("too_large");
            await received.cleanup().catch(() => undefined);
            upload = undefined;
          }
        })
        .catch((err) => {
          // If opening/writing the temporary file fails, Busboy still needs this part drained
          // before it can emit `finish`; otherwise the route can wait forever on a broken volume.
          stream.resume();
          failure = err;
        });
      pendingFiles.push(pending);
    });
    parser.on("error", reject);
    parser.on("finish", async () => {
      await Promise.all(pendingFiles);
      if (failure) reject(failure);
      else resolve();
    });
  });
  // The parser can reject before the request-body loop reaches `await done`.
  // Keep that rejection observed while backpressure is being handled.
  done.catch(() => undefined);

  const reader = request.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!parser.write(Buffer.from(next.value))) {
        const drain = new Promise<void>((resolve, reject) => {
          const onDrain = () => {
            parser.off("error", onError);
            resolve();
          };
          const onError = (err: unknown) => {
            parser.off("drain", onDrain);
            reject(err);
          };
          parser.once("drain", onDrain);
          parser.once("error", onError);
        });
        await Promise.race([drain, done.then(() => undefined, (err) => Promise.reject(err))]);
      }
    }
    parser.end();
    await done;
  } catch (err) {
    try {
      parser.destroy();
    } catch {
      // The parser may already be closed after a malformed request.
    }
    await reader.cancel().catch(() => undefined);
    await Promise.allSettled(pendingFiles);
    await upload?.cleanup().catch(() => undefined);
    throw err;
  } finally {
    reader.releaseLock();
  }
  if (!upload) throw new UploadStreamError("empty");
  return { upload, fields };
}
