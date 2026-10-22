import { pageActor, presentedRole } from "@/app/(app)/_access";
import { listChats } from "@/server/services/telegram";
import { getServerT } from "@/lib/i18n/server";
import { TelegramView } from "@/components/telegram-view";

export default async function TelegramPage() {
  const { actor } = await pageActor();

  // The page hands the chat list to the client as initial data, and the chats are customer
  // conversations: an external partner (guest) gets only a notice and the list is never fetched.
  if (actor.isExternal) {
    const { t } = getServerT();
    return <div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">{t("guest.no_access")}</div>;
  }

  const chats = await listChats(actor.orgId);
  const initial = chats
    ? {
        chats: {
          chats: chats.chats.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
          lastSyncAt: chats.lastSyncAt?.toISOString() ?? null,
        },
        botUsername: (chats.config as { botUsername?: string })?.botUsername ?? null,
      }
    : { chats: null, botUsername: null };

  // The view shows its management controls to an OWNER or an ADMIN: here that is whoever holds the
  // `integrations.manage` switch (the server decides again on every request).
  return <TelegramView ctx={{ orgRole: presentedRole(actor, "integrations.manage") }} initial={initial} />;
}

export const dynamic = "force-dynamic";
