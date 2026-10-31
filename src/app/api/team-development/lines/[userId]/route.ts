import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { setSupervisor, setSupervisorSchema } from "@/server/services/team-lines";

/**
 * «غيّر المسؤول» — PUT { managerId: string | null }. The owner and whoever holds `people.manage_lines` only (404 for anybody
 * else); a loop or a chain deeper than 6 is refused (422); the owner has no supervisor.
 */
export async function PUT(req: Request, { params }: { params: { userId: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const { managerId } = await parseJson(setSupervisorSchema, req);
    return NextResponse.json({ line: await setSupervisor(actor, params.userId, managerId) });
  });
}
