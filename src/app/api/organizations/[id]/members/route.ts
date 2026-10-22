import { NextResponse } from "next/server";
import { parseJson } from "@/server/validation";
import { createAccount, createAccountSchema, requireAccountsActor } from "@/server/services/accounts";
import { listOrgMembers } from "@/server/services/org-members";
import { withAccountsApi } from "./_http";

/** GET: the roster (every status) for whoever holds `users.manage` in this organization. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withAccountsApi(async () => {
    const actor = await requireAccountsActor(params.id);
    return NextResponse.json(await listOrgMembers(actor));
  });
}

/** POST: create an account (username + temporary password); 201 `{ userId, username, temporaryPassword? }`. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withAccountsApi(async () => {
    const actor = await requireAccountsActor(params.id);
    const input = await parseJson(createAccountSchema, req);
    return NextResponse.json(await createAccount(actor, input), { status: 201 });
  });
}
