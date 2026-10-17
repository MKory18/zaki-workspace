import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { requireOrgMember } from "@/server/auth";
import { regenerateJoinCode } from "@/server/services/orgs";

/** Rotate the org invitation join code. OWNER/ADMIN only. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireOrgMember(params.id);
    const code = await regenerateJoinCode(params.id, ctx);
    return NextResponse.json({ joinCode: code });
  });
}
