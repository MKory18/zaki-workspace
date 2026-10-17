import { NextResponse } from "next/server";
import { audit, clearSessionCookie } from "@/server/auth";
import { withApi } from "@/server/api";

export async function POST() {
  return withApi(async () => {
    await clearSessionCookie();
    await audit("auth.logout");
    return NextResponse.json({ ok: true });
  });
}
