import { redirect } from "next/navigation";
import { currentUser, ForbiddenError } from "@/server/auth";
import { db } from "@/server/db";
import { getServerT } from "@/lib/i18n/server";
import { ChatView } from "@/components/chat-view";

/** Internal chat — conversations the user belongs to; nothing outside the org. */
export default async function ChatPage() {
  const { t } = getServerT();
  const user = await currentUser();
  if (!user) redirect("/login");

  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true },
  });
  if (!membership) throw new ForbiddenError("not_org_member");

  if (membership.role === "GUEST") {
    return (
      <div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">
        {t("chat.guest_forbidden")}
      </div>
    );
  }

  return <ChatView ctx={{ orgId: membership.organizationId, orgRole: membership.role }} />;
}

export const dynamic = "force-dynamic";
