import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { TaskDetail } from "@/components/task-detail";

export default async function TaskPage({ params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  // Workspace membership gates task access (writes go through API role checks).
  const wsScope = await accessibleWorkspaceIds(user.id);
  const task = await db.task.findFirst({
    where: {
      id: params.id,
      workspaceId: { in: wsScope.length ? wsScope : ["__none__"] },
    },
    include: {
      labels: { select: { label: true } },
      assignee: { select: { id: true, name: true, email: true } },
      creator: { select: { id: true, name: true } },
      organization: { select: { keyPrefix: true } },
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

  // editable: creator/assignee, or any non-guest member
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id, organizationId: task.orgId },
    select: { role: true },
  });
  const canEdit =
    (membership && membership.role !== "GUEST") ||
    user.id === task.assigneeId ||
    user.id === task.creatorId;

  const [members, labels] = await Promise.all([
    db.workspaceMember.findMany({
      where: { workspaceId: task.workspaceId },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.label.findMany({
      where: { orgId: task.orgId },
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    }),
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
    />
  );
}
