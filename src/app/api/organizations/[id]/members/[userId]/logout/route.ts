import { NextResponse } from "next/server";
import { logoutEverywhere, requireAccountsActor } from "@/server/services/accounts";
import { withAccountsApi } from "../../_http";

/** POST -> `{ ok: true }`: ends every session of the person (log out everywhere); nothing else changes. */
export async function POST(_req: Request, { params }: { params: { id: string; userId: string } }) {
  return withAccountsApi(async () => {
    const actor = await requireAccountsActor(params.id);
    await logoutEverywhere(actor, params.userId);
    return NextResponse.json({ ok: true });
  });
}
