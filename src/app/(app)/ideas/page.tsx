import { pageActor } from "@/app/(app)/_access";
import { listIdeas } from "@/server/services/ideas";
import { IdeasView, type IdeaItem } from "@/components/ideas-view";

export default async function IdeasPage() {
  // Active org = oldest ACTIVE membership (same resolution as the ideas API).
  const { user, actor } = await pageActor();

  const ideas = await listIdeas(actor.orgId, { viewerId: user.id, external: actor.isExternal });
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
        orgRole: actor.role,
        canManage: actor.role === "OWNER" || actor.role === "ADMIN",
      }}
    />
  );
}

export const dynamic = "force-dynamic";
