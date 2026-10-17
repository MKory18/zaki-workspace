import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { currentUser } from "@/server/auth";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { Card, CardBody, Badge, EmptyState } from "@/components/ui/card";
import { ProjectsToolbar } from "@/components/projects-toolbar";
import { WorkspaceMembersButton } from "@/components/workspace-members-button";
import { WorkspaceEditButton } from "@/components/workspace-edit-button";
import { formatDate } from "@/lib/format";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { workspace?: string };
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const accessible = await accessibleWorkspaceIds(user.id);
  if (accessible.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-fg">Projects</h1>
          <ProjectsToolbar />
        </header>
        <EmptyState
          title="No accessible workspaces"
          hint="You are not assigned to any workspace yet — ask an admin to add you."
        />
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
    where: { workspaceId: typeof wsFilter === "string" ? wsFilter : { in: wsFilter.in }, status: { not: "ARCHIVED" } },
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
          Projects
          {wsName ? <span className="text-sm text-fg-muted"> · {wsName}</span> : null}
        </h1>
        <div className="flex items-center gap-2">
          {wsInfo ? (
            <>
              <WorkspaceEditButton workspaceId={wsFilter as string} name={wsInfo.name} description={wsInfo.description} />
              <WorkspaceMembersButton workspaceId={wsFilter as string} />
            </>
          ) : null}
          <ProjectsToolbar />
        </div>
      </header>
      {projects.length === 0 ? (
        <EmptyState title="No projects yet" hint="Create a project to start organizing work." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="block">
              <Card className="transition-colors hover:border-accent/40">
                <CardBody>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-fg">{p.name}</p>
                    <Badge>{p.status}</Badge>
                  </div>
                  {p.description ? (
                    <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{p.description}</p>
                  ) : null}
                  <p className="mt-2 text-[11px] text-muted">
                    {p._count.tasks} tasks · {p._count.boards} boards · due {formatDate(p.targetDate, "en")}
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
