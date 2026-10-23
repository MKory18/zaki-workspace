import { NextResponse } from "next/server";
import { ValidationError } from "@/server/auth";
import { parse, parseJson } from "@/server/validation";
import {
  offboardBodySchema,
  requireAccountsActor,
  setAccountStatus,
  updateAccount,
  updateAccountSchema,
} from "@/server/services/accounts";
import { withAccountsApi } from "../_http";

type Params = { params: { id: string; userId: string } };

/** PATCH: edit name, job title, rank, manager, capabilities, or reset to a given temporary password. */
export async function PATCH(req: Request, { params }: Params) {
  return withAccountsApi(async () => {
    const actor = await requireAccountsActor(params.id);
    const input = await parseJson(updateAccountSchema, req);
    await updateAccount(actor, params.userId, input);
    return NextResponse.json({ ok: true });
  });
}

/**
 * DELETE (legacy "remove from the organization"): no longer deletes anything — it OFFBOARDS the
 * person, exactly like POST status `{ action: "offboard" }`. The receiver of their open work
 * comes from the JSON body (`transferToUserId`) or the query (`?transferTo=`); the body is optional.
 */
export async function DELETE(req: Request, { params }: Params) {
  return withAccountsApi(async () => {
    const actor = await requireAccountsActor(params.id);
    const raw = await req.text();
    const body = raw.trim() ? parse(offboardBodySchema, jsonOf(raw)) : {};
    const fromQuery = new URL(req.url).searchParams.get("transferTo")?.trim() || null;
    await setAccountStatus(actor, params.userId, { action: "offboard", transferToUserId: body.transferToUserId ?? fromQuery });
    return NextResponse.json({ ok: true });
  });
}

function jsonOf(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError([{ path: "body", message: "invalid JSON" }]);
  }
}
