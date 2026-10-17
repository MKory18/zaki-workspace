import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";

/** DELETE one of the caller's own notifications. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const user = await requireUser();
    await db.notification.deleteMany({
      where: { id: params.id, userId: user.id },
    });
    return NextResponse.json({ ok: true });
  });
}
