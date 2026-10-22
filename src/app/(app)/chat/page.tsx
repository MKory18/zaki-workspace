import { pageActor } from "@/app/(app)/_access";
import { getServerT } from "@/lib/i18n/server";
import { ChatView } from "@/components/chat-view";

/** Internal chat — conversations the user belongs to; nothing outside the org. */
export default async function ChatPage() {
  const { t } = getServerT();
  const { actor } = await pageActor();

  if (actor.isExternal) {
    return (
      <div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">
        {t("chat.guest_forbidden")}
      </div>
    );
  }

  return <ChatView ctx={{ orgId: actor.orgId, orgRole: actor.role }} />;
}

export const dynamic = "force-dynamic";
