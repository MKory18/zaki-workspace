import { redirect } from "next/navigation";
import { currentUser, ForbiddenError } from "@/server/auth";
import { db } from "@/server/db";
import { listChats } from "@/server/services/telegram";
import { TelegramView } from "@/components/telegram-view";

export default async function TelegramPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true },
  });
  if (!membership) throw new ForbiddenError("not_org_member");

  const chats = await listChats(membership.organizationId);
  const initial = chats
    ? {
        chats: {
          chats: chats.chats.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
          lastSyncAt: chats.lastSyncAt?.toISOString() ?? null,
        },
        botUsername: (chats.config as { botUsername?: string })?.botUsername ?? null,
      }
    : { chats: null, botUsername: null };

  return <TelegramView ctx={{ orgRole: membership.role }} initial={initial} />;
}

export const dynamic = "force-dynamic";
