import { NextResponse } from "next/server";
import { requireAccountsActor, resetAccountPassword } from "@/server/services/accounts";
import { withAccountsApi } from "../../_http";

/** POST -> `{ ok: true, temporaryPassword }`: a new temporary password, shown once; every session of the person ends. */
export async function POST(_req: Request, { params }: { params: { id: string; userId: string } }) {
  return withAccountsApi(async () => {
    const actor = await requireAccountsActor(params.id);
    const { temporaryPassword } = await resetAccountPassword(actor, params.userId);
    return NextResponse.json({ ok: true, temporaryPassword });
  });
}
