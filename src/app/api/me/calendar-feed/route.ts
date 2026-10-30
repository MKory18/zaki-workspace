import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { createFeedToken, listFeedTokens } from "@/server/services/calendar-feed";

/**
 * «اشتراك التقويم» — the signed-in person's own calendar links (the private feed itself is /api/calendar/feed/<token>.ics).
 *
 *  GET   the person's live links: label, created, last used. Never a token (only its hash is stored).
 *  POST  `{ label? }` makes a link. The answer carries the full address ONCE (`url`); it is never shown again.
 *
 * A guest is refused and the company's `calendarFeed` switch is checked in the service (off: «not found»).
 */
const createSchema = z.object({ label: z.string().max(200).nullable().optional() }).strict();

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ tokens: await listFeedTokens(actor) }, { headers: NO_STORE });
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    // an empty body is the same as `{}`: the label is optional
    const raw = await req.text();
    let body: unknown = {};
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: "validation.failed", message: "validation.failed" }, { status: 422 });
      }
    }
    const input = createSchema.parse(body);
    const actor = await requireActor();
    const made = await createFeedToken(actor, input);
    return NextResponse.json({ url: made.url, token: made.token, entry: made.entry }, { status: 201, headers: NO_STORE });
  });
}
