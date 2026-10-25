import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { pageUser } from "@/server/auth";
import { loadWorkScope, projectVisibleWhere, scopeSpaceIds } from "@/server/services/team-scope";
import { Card, CardBody, Badge, EmptyState } from "@/components/ui/card";
import { ProjectsToolbar } from "@/components/projects-toolbar";
import { WorkspaceMembersButton } from "@/components/workspace-members-button";
import { WorkspaceTeamsButton } from "@/components/workspace-teams-button";
import { WorkspaceEditButton } from "@/components/workspace-edit-button";
import { fmtDMY } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { getServerT } from "@/lib/i18n/server";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { workspace?: string };
}) {
  const { t } = getServerT();
  const user = await pageUser();
  if (!user) redirect("/login");
  // the spaces they may open, and inside a space with teams only the space's own projects and their teams'
  const scope = await loadWorkScope(user.id);
  const accessible = scopeSpaceIds(scope);
  if (accessible.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-fg">{t("nav.projects")}</h1>
          <ProjectsToolbar />
        </header>
        <EmptyState title={t("proj.noWorkspaces")} hint={t("proj.noWorkspacesHint")} />
      </div>
    );
  }
  // Workspace isolation: only projects inside workspaces the caller may open;
  // ?workspace narrows further (ignored when not accessible).
  const wsFilter =
    searchParams.workspace && accessible.includes(searchParams.workspace)
      ? searchParams.workspace
      : { in: accessible };
  const projects = await db.project.findMany({
    where: {
      workspaceId: typeof wsFilter === "string" ? wsFilter : { in: wsFilter.in },
      status: { not: "ARCHIVED" },
      AND: [projectVisibleWhere(scope)],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      priority: true,
      targetDate: true,
      workspace: { select: { name: true } },
      _count: { select: { tasks: { where: { archived: false } }, boards: true } },
    },
  });
  const wsInfo =
    typeof wsFilter === "string"
      ? await db.workspace.findUnique({ where: { id: wsFilter }, select: { name: true, description: true } })
      : null;
  const wsName = wsInfo?.name ?? "";
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-fg">
          {t("nav.projects")}
          {wsName ? <span className="text-sm text-fg-muted"> · {wsName}</span> : null}
        </h1>
        <div className="flex items-center gap-2">
          {wsInfo ? (
            <>
              <WorkspaceEditButton workspaceId={wsFilter as string} name={wsInfo.name} description={wsInfo.description} />
              <WorkspaceMembersButton workspaceId={wsFilter as string} />
              <WorkspaceTeamsButton workspaceId={wsFilter as string} />
            </>
          ) : null}
          <ProjectsToolbar />
        </div>
      </header>
      {projects.length === 0 ? (
        <EmptyState title={t("proj.emptyTitle")} hint={t("proj.emptyHint")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="block">
              <Card className="transition-colors hover:border-accent/40">
                <CardBody>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-fg">{p.name}</p>
                    <Badge>{enumLabel("ProjectStatus", p.status)}</Badge>
                  </div>
                  {p.description ? (
                    <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{p.description}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted">
                    {t("proj.cardLine", { tasks: p._count.tasks, boards: p._count.boards })}
                    {p.targetDate ? ` · ${t("proj.dueLine", { date: fmtDMY(p.targetDate) })}` : ""}
                  </p>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
