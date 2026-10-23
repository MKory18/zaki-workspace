import { NextResponse } from "next/server";
import { apiError, withApi } from "@/server/api";
import { AccountsError } from "@/server/services/accounts";

/**
 * `withApi` for the account routes, plus the two answers it has no error class for: 400 when a
 * choice is missing (who receives a leaver's open work) and 409 for the account's state or a name
 * already in use. Every answer is `no-store`: some of them carry a temporary password.
 * (Not a route: Next only routes files named route.ts.)
 */
export async function withAccountsApi(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  const res = await withApi(async () => {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof AccountsError)) throw err;
      return err.status === 409
        ? apiError("conflict", err.message)
        : NextResponse.json({ error: "bad_request", message: err.message }, { status: 400 });
    }
  });
  res.headers.set("cache-control", "no-store");
  return res;
}
