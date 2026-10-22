import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { pageUser } from "@/server/auth";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui/card";
import { BoardCreateButton } from "@/components/board-create-button";
import { formatDate } from "@/lib/format";
import { TimelineBadgeButton } from "@/components/timeline-badge-button";

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const user = await pageUser();
  if (!user) return null;
  const accessible = await accessibleWorkspaceIds(user.id);
  const project = await db.project.findFirst({
    where: {
      id: params.id,
      workspaceId: { in: accessible.length ? accessible : ["__none__"] },
    },
    include: {
      boards: { where: { archived: false }, select: { id: true, name: true, _count: { select: { tasks: true } } } },
      milestones: { select: { id: true, name: true, status: true, targetDate: true } },
      _count: { select: { tasks: { where: { archived: false } } } },
      workspace: { select: { id: true } },
    },
  });
  if (!project) notFound();
  const doneColumnIds = await db.boardColumn.findMany({
    where: { board: { projectId: project.id }, done: true },
    select: { id: true },
  });
  const doneCount = doneColumnIds.length
    ? await db.task.count({ where: { projectId: project.id, archived: false, columnId: { in: doneColumnIds.map((c) => c.id) } } })
    : 0;
  const open = project._count.tasks;
  const pct = open + doneCount > 0 ? Math.round((doneCount / (open + doneCount)) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header className="space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-fg">{project.name}</h1>
          <TimelineBadgeButton projectId={project.id} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <Badge>{project.status}</Badge>
          <span>target {formatDate(project.targetDate, "en")}</span>
          <span>· {open} open / {doneCount} done · {pct}%</span>
        </div>
        {project.description ? <p className="max-w-2xl text-sm text-fg-muted">{project.description}</p> : null}
      </header>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">Boards</h2>
          <BoardCreateButton projectId={project.id} />
        </div>
        {project.boards.length === 0 ? (
          <p className="text-sm text-fg-muted">No boards yet.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-3">
            {project.boards.map((b) => (
              <Link key={b.id} href={`/boards/${b.id}`}>
                <Card className="transition-colors hover:border-accent/40">
                  <CardBody className="py-3">
                    <p className="text-sm font-medium text-fg">{b.name}</p>
                    <p className="text-[11px] text-muted">{b._count.tasks} tasks</p>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {project.milestones.length > 0 ? (
        <Card>
          <CardHeader>
            <p className="text-sm font-semibold text-fg">Milestones</p>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-border">
              {project.milestones.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-fg">{m.name}</span>
                  <span className="text-xs text-muted">
                    {m.status} · {formatDate(m.targetDate, "en")}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
