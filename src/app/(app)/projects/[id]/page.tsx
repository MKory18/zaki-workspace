import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { pageUser } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { keepInSpace } from "@/server/services/current-space";
import { loadWorkScope, projectVisibleWhere } from "@/server/services/team-scope";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui/card";
import { BoardCreateButton } from "@/components/board-create-button";
import { fmtDMY } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { getServerT } from "@/lib/i18n/server";
import { TimelineBadgeButton } from "@/components/timeline-badge-button";
import { ProjectTeamPicker } from "@/components/project-team-picker";

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const { t } = getServerT();
  const user = await pageUser();
  if (!user) return null;
  // its space and its team: another team's project is «not found», like one that does not exist
  const scope = await loadWorkScope(user.id);
  const project = await db.project.findFirst({
    where: { id: params.id, AND: [projectVisibleWhere(scope)] },
    include: {
      boards: { where: { archived: false }, select: { id: true, name: true, _count: { select: { tasks: true } } } },
      milestones: { select: { id: true, name: true, status: true, targetDate: true } },
      _count: { select: { tasks: { where: { archived: false } } } },
      workspace: { select: { id: true } },
    },
  });
  if (!project) notFound();
  // a thing of another space of theirs: enter that space first, so the name at the top says where it is
  await keepInSpace(await requireActor(), project.workspace.id, `/projects/${project.id}`);
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
          <Badge>{enumLabel("ProjectStatus", project.status)}</Badge>
          <span>
            {[
              project.targetDate ? t("proj.dueLine", { date: fmtDMY(project.targetDate) }) : null,
              t("proj.progressLine", { open, done: doneCount, pct }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {project.description ? <p className="max-w-2xl text-sm text-fg-muted">{project.description}</p> : null}
        <ProjectTeamPicker projectId={project.id} workspaceId={project.workspace.id} teamId={project.teamId} />
      </header>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">{t("proj.boards")}</h2>
          <BoardCreateButton projectId={project.id} />
        </div>
        {project.boards.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("board.empty")}</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-3">
            {project.boards.map((b) => (
              <Link key={b.id} href={`/boards/${b.id}`}>
                <Card className="transition-colors hover:border-accent/40">
                  <CardBody className="py-3">
                    <p className="text-sm font-medium text-fg">{b.name}</p>
                    <p className="text-xs text-muted">{t("proj.tasksCount", { n: b._count.tasks })}</p>
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
            <p className="text-sm font-semibold text-fg">{t("proj.milestones")}</p>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-border">
              {project.milestones.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-fg">{m.name}</span>
                  <span className="text-xs text-muted">
                    {enumLabel("MilestoneStatus", m.status)}
                    {m.targetDate ? ` · ${fmtDMY(m.targetDate)}` : ""}
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
