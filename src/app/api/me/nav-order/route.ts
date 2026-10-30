import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { navOrderSchema } from "@/lib/nav/order";
import { getNavOrder, resetNavOrder, saveNavOrder } from "@/server/services/nav-order";

/**
 * «ترتيبي» — the caller's own order of the menu's places and of the tabs inside each place (`User.navOrder`).
 * Always the CALLER's: there is no id in the address, so there is no way to name somebody else.
 *
 *   GET     → { order }  the saved order, or null (the code's order)
 *   PUT     → { order }  replaces it; `{ places, tabs }` with known keys only, no duplicates, and only places and tabs the
 *                        caller may see (403 `navorder.not_visible` otherwise)
 *   DELETE  → { order: null }  «رجّع الترتيب الأصلي»
 *
 * It is only an order: it never shows or hides a place, and the server still decides every page on its own.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ order: await getNavOrder(actor.userId) });
  });
}

export async function PUT(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(navOrderSchema, req);
    return NextResponse.json({ order: await saveNavOrder(actor, input) });
  });
}

export async function DELETE() {
  return withApi(async () => {
    const actor = await requireActor();
    await resetNavOrder(actor.userId);
    return NextResponse.json({ order: null });
  });
}
