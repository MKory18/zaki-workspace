import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { readAvatar } from "@/server/services/avatars";

/**
 * GET /api/avatars/[id] — one person's picture. An ACTIVE member of the company may see a
 * colleague's face (a guest may not: the staff directory is closed to them). Anything that is not a
 * picture of this company is 404, and the answer is cacheable for a while because the id changes with
 * every new picture.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const file = await readAvatar({ orgId: actor.orgId, userId: actor.userId, orgRole: actor.role }, params.id);
    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        "content-type": file.mimeType,
        "content-length": String(file.buffer.length),
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=604800, immutable",
      },
    });
  });
}
