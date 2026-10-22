import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { directoryContext } from "@/app/api/_access";
import { chatDirectory } from "@/server/services/chat";

/**
 * GET: chatable org members (recipients picker). It is the staff directory, so it follows the
 * `directory.view` switch; a guest gets 403 `chat.guest_forbidden`.
 */
export async function GET() {
  return withApi(async () => {
    const ctx = await directoryContext("chat.guest_forbidden");
    const people = await chatDirectory(ctx.orgId);
    return NextResponse.json({
      people: people.filter((p) => p.userId !== ctx.userId),
    });
  });
}
