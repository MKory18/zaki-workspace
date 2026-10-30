import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTaskAccess } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { setPinned } from "@/server/services/rewards";

/**
 * «تثبيت» — pin or unpin a task: the OWNER and the space's ADMIN (the route asks the space guard for the ADMIN role; the
 * service reads the rank again). A pin never changes who may open the task. Audited.
 *
 *  POST { pinned: boolean }
 */
const schema = z.object({ pinned: z.boolean() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const { pinned } = await parseJson(schema, req);
    const ctx = await requireTaskAccess(params.id, ["ADMIN"]);
    const saved = await setPinned(ctx, params.id, pinned);
    return NextResponse.json({ task: { id: saved.id, pinnedAt: saved.pinnedAt } });
  });
}
