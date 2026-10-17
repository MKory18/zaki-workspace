import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";

/** The caller's notifications (latest 30) + unread count. */
export async function GET() {
  return withApi(async () => {
    const user = await requireUser();
    const [items, unreadCount] = await Promise.all([
      db.notification.findMany({
        where: { userId: user.id },
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
      db.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return NextResponse.json({ items, unreadCount });
  });
}
