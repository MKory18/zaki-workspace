import { redirect } from "next/navigation";
import { currentUser, ForbiddenError } from "@/server/auth";
import { db } from "@/server/db";
import { listChats } from "@/server/services/telegram";
import { getServerT } from "@/lib/i18n/server";
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

  // The page hands the chat list to the client as initial data, and the chats are customer
  // conversations: an external partner (guest) gets only a notice and the list is never fetched.
  if (membership.role === "GUEST") {
    const { t } = getServerT();
    return <div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">{t("guest.no_access")}</div>;
  }

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
