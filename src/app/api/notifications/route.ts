import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { requireActor } from "@/server/policy/actor";
import { bellWhere, currentSpace } from "@/server/services/current-space";

/** The caller's notifications (latest 30) + unread count — of the space they are in, and the personal ones. */
export async function GET() {
  return withApi(async () => {
    const user = await requireUser();
    const space = await currentSpace(await requireActor());
    const mine = bellWhere(user.id, space?.id);
    const [items, unreadCount] = await Promise.all([
      db.notification.findMany({
        where: mine,
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          linkUrl: true,
          taskId: true,
          readAt: true,
          createdAt: true,
        },
      }),
      db.notification.count({ where: { ...mine, readAt: null } }),
    ]);
    return NextResponse.json({ items, unreadCount });
  });
}
