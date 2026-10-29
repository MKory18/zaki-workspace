import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ValidationError } from "@/server/auth";
import { BodyTooLargeError, readTextLimited } from "@/server/http/body-limit";
import { activeOrgCtx } from "@/server/services/integrations";
import { saveWhiteboard, whiteboardOf } from "@/server/chat/whiteboard";

/** A board's save is at most this big (a few thousand strokes). */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** GET: the conversation's whiteboard (empty before anybody drew), and whether the viewer may draw. Its readers. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await whiteboardOf(ctx, params.id), { headers: { "cache-control": "no-store" } });
  });
}

/** PUT `{ elements }`: what this screen changed, merged with what the others drew. Whoever may write here. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    let text: string;
    try {
      // read with the ceiling, not after it: a body bigger than the cap must never be in memory
      text = await readTextLimited(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof BodyTooLargeError) throw new ValidationError([{ path: "elements", message: "whiteboard.e.too_big" }]);
      throw err;
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ValidationError([{ path: "body", message: "invalid JSON" }]);
    }
    const elements = body && typeof body === "object" ? (body as { elements?: unknown }).elements : undefined;
    return NextResponse.json(await saveWhiteboard(ctx, params.id, elements));
  });
}
