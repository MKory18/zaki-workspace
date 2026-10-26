import { NextResponse } from "next/server";
import { apiError, withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { SpaceConflictError } from "@/server/services/workspaces";
import { archiveSchema, setSpaceArchived } from "@/server/services/space-manage";

/** POST { archived }: archive a space or bring it back (the OWNER and the ADMINs; never «الشركة»: 409). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const { archived } = await parseJson(archiveSchema, req);
    try {
      await setSpaceArchived(await requireActor(), params.id, archived);
    } catch (err) {
      if (err instanceof SpaceConflictError) return apiError("conflict", err.message);
      throw err;
    }
    return NextResponse.json({ ok: true });
  });
}
