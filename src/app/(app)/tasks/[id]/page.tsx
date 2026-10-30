import { notFound, redirect } from "next/navigation";
import { pageUser } from "@/server/auth";
import { db } from "@/server/db";
import { actorCanWork, requireActor } from "@/server/policy/actor";
import { actorFeatureOn } from "@/server/services/features";
import { SectionOffNotice } from "@/app/(app)/_access";
import { keepInSpace } from "@/server/services/current-space";
import { loadWorkScope, taskVisibleWhere } from "@/server/services/team-scope";
import { canWriteInWorkspace } from "@/server/workspace-role";
import { TaskDetail } from "@/components/task-detail";

export default async function TaskPage({ params }: { params: { id: string } }) {
  const user = await pageUser();
  if (!user) redirect("/login");

  // Workspace membership gates task access (writes go through API role checks).
  // Workspace membership and the project's team gate task access (writes go through API role checks).
  const scope = await loadWorkScope(user.id);
  const task = await db.task.findFirst({
    where: { id: params.id, AND: [taskVisibleWhere(scope)] },
    include: {
      labels: { select: { label: true } },
      assignee: { select: { id: true, name: true } },
      // «لمين» with more than one person: the others, in the order they were picked
      coAssignees: { select: { userId: true }, orderBy: { createdAt: "asc" } },
      creator: { select: { id: true, name: true } },
      organization: { select: { keyPrefix: true } },
      milestone: { select: { id: true, name: true } },
      column: {
        select: { name: true, board: { select: { id: true, name: true } } },
      },
      comments: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { id: true, name: true } } },
      },
    },
  });
  if (!task) notFound();
  // a thing of another space of theirs: enter that space first, so the name at the top says where it is
  const actor = await requireActor();
  // the tasks row of the person's grid
  if (!actorCanWork(actor, "tasks.view")) return <SectionOffNotice />;
  await keepInSpace(actor, task.workspaceId, `/tasks/${task.id}`);

  // Editable exactly when the API would let the person write in this space (the same rule as the
  // board page): the real organization rank and the real row in the space. An org guest never
  // writes, a space guest row makes even a member read-only, and being the creator or the assignee
  // of the task changes nothing - the server refuses a write the screen would have offered.
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id, organizationId: task.orgId, status: "ACTIVE" },
    select: { role: true },
  });
  const spaceRow = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: task.workspaceId, userId: user.id } },
    select: { role: true },
  });
  // the space's rule, and the tasks row's «يضيف ويعدّل» box of the section grid
  const canEdit = membership ? canWriteInWorkspace(membership.role, spaceRow?.role) && actorCanWork(actor, "tasks.edit") : false;

  // «التبعيات»: the switch decides whether the card exists at all, and the picker offers the other
  // tasks of the SAME space that this person may see (the team rule, not the whole company)
  const linksOn = await actorFeatureOn(actor, "taskLinks");
  // «المعالم»: the picker on the task is drawn only while the company's switch is on, and only when the
  // task's project actually has milestones to point at
  const milestonesOn = await actorFeatureOn(actor, "milestones");
  const projectMilestones = milestonesOn
    ? await db.milestone.findMany({
        where: { projectId: task.projectId },
        orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true },
      })
    : [];

  const [members, labels, linkCandidates] = await Promise.all([
    // the people who can be assigned: the space's members who are still ACTIVE in the company (a
    // suspended person keeps their space row so that reactivating them restores everything, but
    // they must not be offered)
    db.workspaceMember.findMany({
      where: {
        workspaceId: task.workspaceId,
        user: { memberships: { some: { organizationId: task.orgId, status: "ACTIVE" } } },
      },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.label.findMany({
      where: { orgId: task.orgId },
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    }),
    // the other tasks of this space, in the same team scope the page itself was read with
    linksOn
      ? db.task.findMany({
          where: {
            workspaceId: task.workspaceId,
            id: { not: task.id },
            archived: false,
            AND: [taskVisibleWhere(scope)],
          },
          select: { id: true, number: true, title: true, organization: { select: { keyPrefix: true } } },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : Promise.resolve([]),
  ]);

  return (
    <TaskDetail
      task={{
        id: task.id,
        number: task.number,
        key: `${task.organization.keyPrefix}-${task.number}`,
        title: task.title,
        description: task.description,
        priority: task.priority,
        type: task.type,
        status: task.column.name,
        boardId: task.column.board.id,
        boardName: task.column.board.name,
        dueDate: task.dueDate?.toISOString() ?? null,
        creatorName: task.creator.name,
        assigneeId: task.assigneeId,
        assigneeName: task.assignee?.name ?? null,
        assigneeIds: [...(task.assigneeId ? [task.assigneeId] : []), ...task.coAssignees.map((r) => r.userId)],
        milestoneId: task.milestoneId,
        milestoneName: task.milestone?.name ?? null,
        labelIds: task.labels.map((l) => l.label.id),
        comments: task.comments.map((c) => ({
          id: c.id,
          author: c.author.name,
          authorId: c.author.id,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
        })),
      }}
      canEdit={canEdit}
      currentUserId={user.id}
      members={members.map((m) => ({ id: m.user.id, name: m.user.name }))}
      labels={labels}
      links={
        linksOn
          ? {
              candidates: linkCandidates.map((c) => ({
                id: c.id,
                key: `${c.organization.keyPrefix}-${c.number}`,
                title: c.title,
              })),
            }
          : null
      }
      milestones={milestonesOn ? projectMilestones : null}
    />
  );
}
