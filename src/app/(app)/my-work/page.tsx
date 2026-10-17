import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import {
  dayWindow,
  queryTasksForView,
  type ViewTask,
} from "@/server/services/views";
import { TaskRow } from "@/components/task-row";
import { getServerT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

const TABS = ["today", "upcoming", "overdue", "completed", "mine", "created"] as const;
type WorkTab = (typeof TABS)[number];

const TAB_KEYS: Record<WorkTab, string> = {
  today: "mywork.tab.today",
  upcoming: "mywork.tab.upcoming",
  overdue: "mywork.tab.overdue",
  completed: "mywork.tab.completed",
  mine: "mywork.tab.mine",
  created: "mywork.tab.created",
};

type Row = { task: ViewTask; editable: boolean };

export default async function MyWorkPage({ searchParams }: { searchParams: { tab?: string } }) {
  const { t } = getServerT();
  const user = await currentUser();
  if (!user) redirect("/login");

  const wanted = (searchParams.tab ?? "") as WorkTab;
  const tab: WorkTab = TABS.includes(wanted) ? wanted : "today";

  const memberships = await db.organizationMember.findMany({
    where: { userId: user.id },
    select: { organizationId: true, role: true },
  });

  const day = dayWindow();
  const dayAfter = new Date(day.to.getTime() + 1);

  const tabQueries: Record<WorkTab, Parameters<typeof queryTasksForView>[0]> = {
    today: { orgId: "", dueFrom: day.from, dueTo: day.to, openOnly: true },
    upcoming: { orgId: "", dueFrom: dayAfter, openOnly: true },
    overdue: { orgId: "", overdueOnly: true },
    completed: { orgId: "", completedOnly: true, limit: 100 },
    mine: { orgId: "", assigneeId: user.id, openOnly: true },
    created: { orgId: "", creatorId: user.id, openOnly: true },
  };

  // One evaluation per tab per org; every query is org-scoped.
  const results = new Map<WorkTab, Row[]>();
  for (const key of TABS) results.set(key, []);

  for (const m of memberships) {
    const editable = m.role !== "GUEST";
    for (const key of TABS) {
      const found = await queryTasksForView({ ...tabQueries[key], orgId: m.organizationId });
      found.forEach((task) => results.get(key)!.push({ task, editable }));
    }
  }

  const current = results.get(tab)!;
  const rows = sortRows(current, tab === "completed" ? "completed" : "due");

  return (
    <main className="flex h-full min-w-0 flex-col overflow-y-auto">
      <header className="border-b border-border bg-surface px-5 py-4">
        <h1 className="text-base font-semibold text-fg">{t("mywork.title")}</h1>
        <p className="text-xs text-fg-muted">{t("mywork.subtitle")}</p>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-4" aria-label={t("mywork.title")}>
        {TABS.map((k) => (
          <a
            key={k}
            href={`/my-work?tab=${k}`}
            aria-current={k === tab ? "true" : undefined}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-xs transition-colors",
              k === tab
                ? "border-accent font-medium text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t(TAB_KEYS[k])}
            <span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-fg-muted">
              {results.get(k)!.length}
            </span>
          </a>
        ))}
      </nav>

      <div className="flex-1 px-3 py-3">
        {rows.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted">{t("mywork.empty")}</p>
        ) : (
          <ul className="max-w-4xl divide-y divide-border/60">
            {rows.map(({ task, editable }) => (
              <TaskRow key={task.id} task={task} editable={editable} showProject />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function sortRows(rows: Row[], by: "due" | "completed"): Row[] {
  return [...rows].sort((a, b) => {
    if (by === "completed") {
      return (b.task.completedAt?.getTime() ?? 0) - (a.task.completedAt?.getTime() ?? 0);
    }
    const da = a.task.dueDate?.getTime() ?? null;
    const db = b.task.dueDate?.getTime() ?? null;
    if (da === null && db === null) {
      return b.task.updatedAt.getTime() - a.task.updatedAt.getTime();
    }
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

export const dynamic = "force-dynamic";
