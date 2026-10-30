import { notFound } from "next/navigation";
import { pageUser } from "@/server/auth";
import { actorCanWork, requireActor } from "@/server/policy/actor";
import { SectionOffNotice } from "@/app/(app)/_access";
import { keepInSpace } from "@/server/services/current-space";
import { db } from "@/server/db";
import { loadWorkScope, projectVisibleWhere } from "@/server/services/team-scope";
import { TASK_INCLUDE } from "@/server/services/tasks";
import { canWriteInWorkspace } from "@/server/workspace-role";
import { BoardView, type TaskCardData } from "@/components/board-view";
import { actorFeatureOn } from "@/server/services/features";
import { stepProgressFor } from "@/server/services/task-steps";

/**
 * A board opens for whoever may open its space (`accessibleWorkspaceIds`: a row in the space, or the owner) and is
 * an ACTIVE member of its company. Anybody else - and an old link to a board that is gone - gets the shell's «not
 * found» page through `notFound()`: one answer for «not there» and «not yours», so it does not tell a stranger the
 * board exists. A thrown domain error would reach the visitor as Next's bare «Application error» screen.
 */
export default async function BoardPage({ params }: { params: { id: string } }) {
  const user = await pageUser();
  if (!user) return null;

  // its project's space and team: another team's board is «not found»
  const scope = await loadWorkScope(user.id);
  const board = await db.board.findFirst({
    where: { id: params.id, project: projectVisibleWhere(scope) },
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
  if (!board) notFound();
  // a thing of another space of theirs: enter that space first, so the name at the top says where it is
  const actor = await requireActor();
  // the projects row of the person's grid
  if (!actorCanWork(actor, "projects.view")) return <SectionOffNotice />;
  await keepInSpace(actor, board.project.workspace.id, `/boards/${board.id}`);

  const member = await db.organizationMember.findFirst({
    where: { organizationId: board.project.workspace.organizationId, userId: user.id, status: "ACTIVE" },
    select: { role: true },
  });
  if (!member) notFound();
  const wsRow = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: board.project.workspace.id, userId: user.id } },
    select: { role: true },
  });

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

  // «٣ من ٥» on the cards: one grouped read for the whole board, and only while the company's switch is on
  const progress = (await actorFeatureOn(actor, "taskSteps")) ? await stepProgressFor(tasks.map((t) => t.id)) : new Map();

  const taskData: TaskCardData[] = tasks.map((t) => ({
    id: t.id,
    key: `${org?.keyPrefix ?? "ZW"}-${t.number}`,
    title: t.title,
    priority: t.priority,
    columnId: t.columnId,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    labels: t.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
    assigneeNames: [...(t.assignee ? [t.assignee.name] : []), ...t.coAssignees.map((r) => r.user.name)],
    commentCount: t._count.comments,
    completed: t.completedAt != null,
    steps: progress.get(t.id),
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
      // the space's rule, and the tasks row's «يضيف ويعدّل» box of the section grid (add, drag, edit)
      canEdit={canWriteInWorkspace(member.role, wsRow?.role) && actorCanWork(actor, "tasks.edit")}
    />
  );
}
