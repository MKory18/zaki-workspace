import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { ValidationError } from "@/server/auth";
import { BodyTooLargeError, readFormDataLimited } from "@/server/http/body-limit";
import { CHAT_LIMITS } from "@/server/files/sniff";
import { requireActor } from "@/server/policy/actor";
import { createChatUpload } from "@/server/chat/attachments";

/**
 * POST /api/chat/uploads — a chat attachment BEFORE its message: the file binds to the
 * uploader only (the conversation is not known yet); the message claims it afterwards.
 * The bytes decide the kind; a declared kind that disagrees is refused. Guests may upload
 * (they post in the topics of their spaces).
 */
const formKind = z.enum(["IMAGE", "VIDEO", "AUDIO", "FILE", "VOICE"]);

/** One form: the biggest kind chat accepts (a video), plus the multipart envelope. */
const MAX_FORM_BYTES = CHAT_LIMITS.VIDEO + 1024 * 1024;

export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    let form: FormData;
    try {
      form = await readFormDataLimited(req, MAX_FORM_BYTES);
    } catch (err) {
      if (err instanceof BodyTooLargeError) throw new ValidationError([{ path: "file", message: "chat.f.too_large" }]);
      throw err;
    }
    const entry = form.get("file");
    if (!(entry instanceof File)) throw new ValidationError([{ path: "file", message: "chat.f.empty" }]);
    const rawKind = form.get("kind");
    const parsed = formKind.safeParse(typeof rawKind === "string" ? rawKind : undefined);
    if (!parsed.success) throw new ValidationError([{ path: "kind", message: "chat.f.kind_required" }]);
    const durationRaw = form.get("durationMs");
    const peaksRaw = form.get("peaks");

    let peaks: unknown;
    if (typeof peaksRaw === "string" && peaksRaw.trim() !== "") {
      try {
        peaks = JSON.parse(peaksRaw);
      } catch {
        throw new ValidationError([{ path: "peaks", message: "chat.f.bad_peaks" }]);
      }
    }

    const made = await createChatUpload({
      actor,
      name: entry.name,
      bytes: new Uint8Array(await entry.arrayBuffer()),
      declaredKind: parsed.data,
      durationMs: typeof durationRaw === "string" ? Number(durationRaw) : undefined,
      peaks,
    });
    return NextResponse.json(made, { status: 201 });
  });
}
