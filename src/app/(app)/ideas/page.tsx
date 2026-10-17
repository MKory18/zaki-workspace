import { redirect } from "next/navigation";
import { currentUser, ForbiddenError } from "@/server/auth";
import { db } from "@/server/db";
import { listIdeas } from "@/server/services/ideas";
import { IdeasView, type IdeaItem } from "@/components/ideas-view";

export default async function IdeasPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  // Active org = oldest membership (same resolution as the ideas API).
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true },
  });
  if (!membership) throw new ForbiddenError("not_org_member");

  const ideas = await listIdeas(membership.organizationId, { viewerId: user.id });
  const initial: IdeaItem[] = ideas.map((i) => ({
    id: i.id,
    title: i.title,
    description: i.description,
    status: i.status,
    taskId: i.taskId,
    creatorId: i.creatorId,
    creatorName: i.creatorName,
    creatorJobTitle: i.creatorJobTitle,
    voteCount: i.voteCount,
    votedByMe: i.votedByMe,
  }));

  return (
    <IdeasView
      initial={initial}
      ctx={{
        userId: user.id,
        orgRole: membership.role,
        canManage: membership.role === "OWNER" || membership.role === "ADMIN",
      }}
    />
  );
}

export const dynamic = "force-dynamic";
