import { NextResponse } from "next/server";
import { parseJson } from "@/server/validation";
import { accountStatusSchema, requireAccountsActor, setAccountStatus } from "@/server/services/accounts";
import { withAccountsApi } from "../../_http";

/**
 * POST `{ action: "suspend" | "reactivate" | "offboard", transferToUserId? }` -> `{ ok: true, temporaryPassword? }`.
 * Reactivation returns a new temporary password (once); offboarding needs `transferToUserId`
 * when the person still has open work (400 `accounts.transfer_required`).
 */
export async function POST(req: Request, { params }: { params: { id: string; userId: string } }) {
  return withAccountsApi(async () => {
    const actor = await requireAccountsActor(params.id);
    const input = await parseJson(accountStatusSchema, req);
    const result = await setAccountStatus(actor, params.userId, input);
    return NextResponse.json({ ok: true, ...result });
  });
}
