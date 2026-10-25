import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { directoryContext } from "@/app/api/_access";
import { chatDirectory } from "@/server/chat/directory";
import { currentSpace } from "@/server/services/current-space";

/**
 * GET: chatable org members (recipients picker). It is the staff directory, so it follows the
 * `directory.view` switch; a guest gets 403 `chat.guest_forbidden`.
 */
export async function GET() {
  return withApi(async () => {
    const ctx = await directoryContext("chat.guest_forbidden");
    // the people of the space the person is in
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    const people = await chatDirectory(ctx.orgId, space?.id ?? null);
    return NextResponse.json({
      people: people
        .filter((p) => p.userId !== ctx.userId)
        .map((p) => ({
          userId: p.userId,
          role: p.role,
          user: { id: p.userId, name: p.name, jobTitle: p.jobTitle },
        })),
    });
  });
}
