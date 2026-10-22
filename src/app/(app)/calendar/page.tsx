import { redirect } from "next/navigation";
import {
  monthWindow,
  dayWindow,
  shiftMonth,
  queryTasksForView,
  resolveWorkspaceView,
} from "@/server/services/views";
import { pageUser } from "@/server/auth";
import { monthName } from "@/lib/format";
import { CalendarGrid, type CalTask } from "@/components/calendar-grid";
import { getServerT } from "@/lib/i18n/server";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { month?: string; workspace?: string; mine?: string; project?: string };
}) {
  const { t, locale } = getServerT();
  const view = await resolveWorkspaceView(searchParams.workspace);
  if ("pageRedirect" in view) redirect("/login");

  if ("none" in view) {
    return (
      <main className="grid h-full place-items-center p-8 text-center">
        <div>
          <h1 className="text-base font-semibold text-fg">{t("cal.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("list.noWorkspace")}</p>
        </div>
      </main>
    );
  }

  const ctx = view.ctx;
  const user = await pageUser();
  if (!user) redirect("/login");

  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "") ? searchParams.month! : new Date().toISOString().slice(0, 7);
  const win = monthWindow(month);
  const mine = searchParams.mine === "1";

  const tasks = ctx.denied
    ? []
    : await queryTasksForView({
        orgId: ctx.orgId,
        workspaceId: ctx.workspaceId,
        projectId: searchParams.project || undefined,
        assigneeId: mine ? user.id : undefined,
        dueFrom: win.from,
        dueTo: win.to,
        openOnly: true,
        limit: 300,
      });

  const calTasks: CalTask[] = tasks
    .filter((task) => task.dueDate != null)
    .map((task) => ({
      id: task.id,
      key: task.key,
      title: task.title,
      dueDate: task.dueDate!.toISOString(),
    }));

  const shift = (delta: number): string => shiftMonth(month, delta);
  const monthTitle = `${monthName(Number(month.slice(5, 7)) - 1, "ar")} ${month.slice(0, 4)}`;
  const todayIso = dayWindow().from.toISOString().slice(0, 10);
  const mineUrl = `/calendar?workspace=${ctx.workspaceId}&month=${month}${mine ? "" : "&mine=1"}`;

  return (
    <main className="flex h-full min-w-0 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-3">
        <div className="flex-1">
          <h1 className="text-base font-semibold text-fg">{t("cal.title")}</h1>
          <p className="text-xs text-fg-muted">{ctx.denied ? t("forbidden") : ctx.workspaceName}</p>
        </div>
        <a
          href={mineUrl}
          aria-current={mine ? "true" : undefined}
          className="rounded-lg border border-border px-2.5 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          {t("cal.mineOnly")}
        </a>
        <nav className="flex items-center gap-1" aria-label={t("cal.title")}>
          <a href={`/calendar?workspace=${ctx.workspaceId}&month=${shift(-1)}${mine ? "&mine=1" : ""}`} className="rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label={t("cal.prev")}>
            ‹
          </a>
          <span className="min-w-32 px-2 text-center text-sm text-fg">{monthTitle}</span>
          <a href={`/calendar?workspace=${ctx.workspaceId}&month=${shift(1)}${mine ? "&mine=1" : ""}`} className="rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label={t("cal.next")}>
            ›
          </a>
        </nav>
      </header>

      <div className="min-h-0 flex-1 px-3 py-3">
        {ctx.denied ? (
          <p className="px-2 py-10 text-center text-sm text-muted">{t("forbidden")}</p>
        ) : (
          <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface">
            <CalendarGrid month={month} tasks={calTasks} todayIso={todayIso} editable={ctx.editable} />
            {calTasks.length === 0 ? (
              <p className="px-2 pb-2 text-center text-xs text-muted">{t("cal.empty")}</p>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}

export const dynamic = "force-dynamic";
