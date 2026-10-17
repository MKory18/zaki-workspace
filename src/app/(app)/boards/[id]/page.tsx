import { currentUser, ForbiddenError, NotFoundError } from "@/server/auth";
import { db } from "@/server/db";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { TASK_INCLUDE } from "@/server/services/tasks";
import { BoardView, type TaskCardData } from "@/components/board-view";

export default async function BoardPage({ params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) return null;

  const accessible = await accessibleWorkspaceIds(user.id);
  const board = await db.board.findFirst({
    where: { id: params.id, project: { workspaceId: { in: accessible.length ? accessible : ["__none__"] } } },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          workspace: { select: { id: true, name: true, organizationId: true } },
        },
      },
    },
  });
  if (!board) throw new NotFoundError("board.not_found");

  const member = await db.organizationMember.findFirst({
    where: { organizationId: board.project.workspace.organizationId, userId: user.id },
    select: { role: true },
  });
  if (!member) throw new ForbiddenError("not_org_member");

  const [columns, tasks, org] = await Promise.all([
    db.boardColumn.findMany({
      where: { boardId: board.id },
      orderBy: { position: "asc" },
      select: { id: true, name: true, color: true, position: true, done: true },
    }),
    db.task.findMany({
      where: { boardId: board.id, archived: false },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      include: TASK_INCLUDE,
    }),
    db.organization.findUnique({
      where: { id: board.project.workspace.organizationId },
      select: { keyPrefix: true },
    }),
  ]);

  const taskData: TaskCardData[] = tasks.map((t) => ({
    id: t.id,
    key: `${org?.keyPrefix ?? "ZW"}-${t.number}`,
    title: t.title,
    priority: t.priority,
    columnId: t.columnId,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    labels: t.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
    commentCount: t._count.comments,
    completed: t.completedAt != null,
  }));

  return (
    <BoardView
      board={{
        id: board.id,
        workspaceId: board.project.workspace.id,
        projectId: board.project.id,
        name: board.name,
        projectName: board.project.name,
      }}
      columns={columns}
      tasks={taskData}
      canEdit={member.role !== "GUEST"}
    />
  );
}
