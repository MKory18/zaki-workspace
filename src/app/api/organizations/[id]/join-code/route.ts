import { NextResponse } from "next/server";

/**
 * RETIRED. The invitation code used to let anybody holding it create an account in the
 * organization; accounts are now created by the owner (and the people they allow) inside the app.
 * The endpoint answers 410 for good. `Organization.joinCode` and its stored values are kept
 * (additive-only database rule) but no code path honours them any more.
 */
function gone(): NextResponse {
  return NextResponse.json({ error: "gone", message: "auth.registration_closed" }, { status: 410 });
}

export async function POST() {
  return gone();
}

export async function GET() {
  return gone();
}
