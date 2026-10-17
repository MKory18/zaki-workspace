import { redirect } from "next/navigation";
import { currentUser, ForbiddenError } from "@/server/auth";
import { db } from "@/server/db";
import { getServerT } from "@/lib/i18n/server";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { fmtNumber } from "@/lib/format";
import type { TaskPriority, IdeaStatus } from "@prisma/client";

/** Org-wide analytics, workspace-filtered (verified after source recovery). */
async function loadAnalytics(wsIds: string[]) {
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const in7 = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const scope = { archived: false, workspaceId: { in: wsIds } };
  const [total, open, completed, overdue, created30, completed30, upcoming7, byPriority, byStatus30, assignees, ideas, workspaces, projects] =
    await Promise.all([
      db.task.count({ where: scope }),
      db.task.count({ where: { ...scope, completedAt: null } }),
      db.task.count({ where: { ...scope, completedAt: { not: null } } }),
      db.task.count({ where: { ...scope, completedAt: null, dueDate: { lt: now } } }),
      db.task.count({ where: { ...scope, createdAt: { gte: since30 } } }),
      db.task.count({ where: { ...scope, completedAt: { gte: since30 } } }),
      db.task.count({ where: { ...scope, completedAt: null, dueDate: { gte: now, lte: in7 } } }),
      db.task.groupBy({ by: ["priority"], where: { ...scope, completedAt: null }, _count: { _all: true } }),
      db.idea.groupBy({ by: ["status"], where: {}, _count: { _all: true } }),
      db.task.groupBy({
        by: ["assigneeId"],
        where: { ...scope, completedAt: null, assigneeId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { assigneeId: "desc" } },
        take: 8,
      }),
      db.idea.count({}),
      db.workspace.count({}),
      db.project.count({ where: { workspaceId: { in: wsIds } } }),
    ]);
  const nameOf = new Map(
    assignees.length
      ? (await db.user.findMany({ where: { id: { in: assignees.map((a) => a.assigneeId!) } }, select: { id: true, name: true } })).map(
          (u) => [u.id, u.name] as const,
        )
      : [],
  );
  return { total, open, completed, overdue, created30, completed30, upcoming7, byPriority, byStatus30, assignees, ideas, workspaces, projects, nameOf };
}

export default async function AnalyticsPage() {
  const { t } = getServerT();
  const user = await currentUser();
  if (!user) redirect("/login");
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true },
  });
  if (!membership) throw new ForbiddenError("not_org_member");
  const wsScope = await accessibleWorkspaceIds(user.id);
  const data = await loadAnalytics(wsScope.length ? wsScope : ["__none__"]);
  const byPriority = new Map(data.byPriority.map((row) => [row.priority, row._count._all]));
  const byStatus = new Map(data.byStatus30.map((row) => [row.status, row._count._all]));
  const maxWorkload = Math.max(1, ...data.assignees.map((a) => a._count._all));
const priorities: TaskPriority[] = ["URGENT", "HIGH", "NORMAL", "LOW", "NONE"];
  const maxPriority = Math.max(1, ...priorities.map((p) => byPriority.get(p) ?? 0));
const ideaStatuses: IdeaStatus[] = ["NEW", "UNDER_REVIEW", "ACCEPTED", "REJECTED"];
  const maxIdea = Math.max(1, ...ideaStatuses.map((s) => byStatus.get(s) ?? 0));
  const rate = data.total > 0 ? Math.round((data.completed / data.total) * 100) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">{t("analytics.title")}</h1>
        <p className="text-xs text-muted">{t("analytics.subtitle")}</p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t("analytics.totalTasks")} value={data.total} hint={t("analytics.totalTasksHint")} />
        <StatCard label={t("analytics.openTasks")} value={data.open} />
        <StatCard label={t("analytics.completed")} value={data.completed} hint={t("analytics.completionRate", { rate: rate ?? 0 })} />
        <StatCard
          label={t("analytics.overdue")}
          value={data.overdue}
          tone={data.overdue > 0 ? "warn" : "good"}
          hint={data.overdue > 0 ? t("analytics.overdueNote") : t("analytics.allGood")}
        />
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label={t("analytics.created30")} value={data.created30} />
        <StatCard label={t("analytics.completed30")} value={data.completed30} />
        <StatCard label={t("analytics.upcoming7")} value={data.upcoming7} />
      </section>

      <section className="rounded-xl border border-border bg-surface-1 p-5">
        <h2 className="mb-3 text-sm font-semibold">{t("analytics.openByPriority")}</h2>
        <div className="space-y-2">
          {priorities.map((p) => {
            const count = byPriority.get(p) ?? 0;
            return <BarRow key={p} label={t(`priority.${p as TaskPriority}`)} count={count} pct={(count / maxPriority) * 100} barClass="bg-accent" />;
          })}
          {data.open === 0 ? <p className="text-xs text-muted">{t("analytics.noOpen")}</p> : null}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface-1 p-5">
        <h2 className="mb-3 text-sm font-semibold">{t("analytics.workload")}</h2>
        <div className="space-y-2">
          {data.assignees.map((a) => (
            <BarRow
              key={a.assigneeId}
              label={data.nameOf.get(a.assigneeId!) ?? "—"}
              count={a._count._all}
              pct={(a._count._all / maxWorkload) * 100}
              barClass="bg-emerald-500"
            />
          ))}
          {data.assignees.length === 0 ? <p className="text-xs text-muted">{t("analytics.noWorkload")}</p> : null}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface-1 p-5">
        <h2 className="mb-3 text-sm font-semibold">
          {t("analytics.ideasFunnel")}
          <span className="ml-2 text-[10px] font-normal text-muted">{t("analytics.ideasTotal", { total: data.ideas })}</span>
        </h2>
        <div className="grid grid-cols-4 gap-2">
          {ideaStatuses.map((status) => {
            const count = byStatus.get(status) ?? 0;
            return (
              <div key={status} className="rounded-lg border border-border p-2 text-center">
                <div className="text-lg font-semibold">{count}</div>
                <div className="text-[10px] text-muted">{t(`ideas.status.${status as IdeaStatus}`)}</div>
                <div className="mt-1 h-1 rounded bg-surface-2">
                  <div className="h-1 rounded bg-sky-500" style={{ width: `${(count / maxIdea) * 100}%` }} />
                </div>
              </div>
            );
          })}
          {data.ideas === 0 ? <p className="col-span-4 text-xs text-muted">{t("analytics.noIdeas")}</p> : null}
        </div>
      </section>

      <footer className="flex flex-wrap gap-4 text-[11px] text-muted">
        <span>{t("analytics.statWorkspaces", { n: data.workspaces })}</span>
        <span>{t("analytics.statProjects", { n: data.projects })}</span>
        <span>{t("analytics.formulaNote")}</span>
      </footer>
    </div>
  );
}

function StatCard({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "warn" | "good" }) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === "warn" ? "text-red-500" : tone === "good" ? "text-emerald-600" : ""}`}>
        {fmtNumber(value)}
      </div>
      {hint ? <div className="mt-0.5 text-[10px] text-muted">{hint}</div> : null}
    </div>
  );
}

function BarRow({ label, count, pct, barClass }: { label: string; count: number; pct: number; barClass: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 truncate text-xs">{label}</span>
      <div className="flex-1">
        <div className="h-2 rounded bg-surface-2">
          <div className={`h-2 rounded ${barClass}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className="w-8 text-right text-xs font-medium">{count}</span>
    </div>
  );
}

export const dynamic = "force-dynamic";
