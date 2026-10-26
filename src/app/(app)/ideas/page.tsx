import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { listIdeas } from "@/server/services/ideas";
import { currentSpace } from "@/server/services/current-space";
import { IdeasView, type IdeaItem } from "@/components/ideas-view";

export default async function IdeasPage() {
  // Active org = oldest ACTIVE membership (same resolution as the ideas API).
  const { user, actor } = await pageActor();
  // The ideas are the team's own (every idea carries its author's name): the tab is for staff and
  // /api/ideas refuses an external partner, so the list is never read for them.
  if (refusedToGuest(actor, "ideas")) return <GuestNotice />;
  // the ideas row of the person's grid
  if (!actorCan(actor, "ideas.view")) return <SectionOffNotice />;

  // the ideas of the space the person is in; «الشركة» also reads the ones shared with the company
  const space = await currentSpace(actor);
  const isHq = space?.kind === "HQ";
  const ideas = await listIdeas(actor.orgId, { viewerId: user.id, external: actor.isExternal, place: { spaceId: space?.id ?? null, isHq } });
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
    workspaceId: i.workspaceId,
    spaceName: i.spaceName,
    shared: i.shared,
  }));

  return (
    <IdeasView
      initial={initial}
      ctx={{
        userId: user.id,
        orgRole: actor.role,
        // the managers of this space move its ideas along; in «الشركة» the owner and the admins
        canManage: isHq ? actor.role === "OWNER" || actor.role === "ADMIN" : Boolean(space?.manager),
        mayEdit: actorCan(actor, "ideas.edit"),
        mayDelete: actorCan(actor, "ideas.delete"),
        spaceId: space?.id ?? null,
        isHq,
      }}
    />
  );
}

export const dynamic = "force-dynamic";
