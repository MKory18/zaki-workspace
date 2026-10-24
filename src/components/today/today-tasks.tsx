import Link from "next/link";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/card";
import { fmtNumber } from "@/lib/format";
import { getServerT } from "@/lib/i18n/server";
import { dayProgress, type TodayQuickAddData, type TodayTask, type TodayTasks } from "@/lib/today";
import { cn } from "@/lib/utils";
import { TodayTaskRow, type RowTone } from "./today-task-row";
import { TodayQuickAdd } from "./quick-add";

/** Where «عرض الباقي» of each group goes: the tab of «مهامي» that holds the rest. */
const REST_HREF: Record<RowTone, string> = {
  overdue: "/my-work?tab=overdue",
  today: "/my-work?tab=today",
  later: "/my-work?tab=mine",
};

/**
 * «مهمّاتي اليوم»: «x من y خلصت» under the title and the star between two rules («نجمة وطريق»), then the
 * person's open tasks in three groups, «متأخرة» (due before today), «اليوم» and «لاحقًا» (the
 * next few, with a due date or none), each row finishable with one press.
 *
 * - The list container carries the tour's hook `today-tasks`, whether or not there is anything in it.
 *   Somebody who may open a space of their own (the owner of a new company, above all) is told to open the first
 *   one; everybody else is told that the owner puts people in spaces, and where to read about them.
 * - Nothing in it is a decoration: it is a list somebody reads every day. Empty, it is an `EmptyState` with the
 *   next step («افتح مهامي») and the owner's drawing slot `empty-tasks`; for a person who is in no space yet it
 *   says so instead of pretending they have no work.
 * - Colour means something here: the danger colour is for what is late, and only for that.
 * - At its foot the inline quick add (`TodayQuickAdd`), for whoever may add a task.
 */
export function TodayTasksCard({
  tasks,
  hasSpaces,
  canCreateSpaces = false,
  quickAdd = null,
  timeZone = "UTC",
}: {
  tasks: TodayTasks;
  hasSpaces: boolean;
  canCreateSpaces?: boolean;
  /** What the inline quick add needs; null for somebody who may add nowhere. */
  quickAdd?: TodayQuickAddData | null;
  timeZone?: string;
}) {
  const { t } = getServerT();
  const { counts } = tasks;
  const progress = dayProgress(counts);
  const nothingDueButLater = counts.open > 0 && counts.overdue === 0 && counts.today === 0;

  return (
    <section aria-labelledby="today-tasks-title" className="rounded-card border border-border bg-surface-1 shadow-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
        <div className="min-w-0">
          <h2 id="today-tasks-title" className="text-base font-semibold text-fg">
            {t("today.tasks.title")}
          </h2>
          {progress.total > 0 ? (
            <p className="text-xs text-fg-muted">{t("today.tasks.progress", { done: fmtNumber(progress.done), total: fmtNumber(progress.total) })}</p>
          ) : null}
        </div>
        {counts.open > 0 ? (
          <Link href="/my-work" className="ms-auto inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent hover:underline">
            {t("today.tasks.see_all")}
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
        {counts.open > 0 ? (
          <ul className="flex basis-full flex-wrap gap-2" role="list">
            {counts.overdue > 0 ? <Chip tone="danger" count={counts.overdue} label={t("mywork.tab.overdue")} /> : null}
            {counts.today > 0 ? <Chip tone="plain" count={counts.today} label={t("mywork.tab.today")} /> : null}
            {counts.later > 0 ? <Chip tone="plain" count={counts.later} label={t("today.tasks.later")} /> : null}
          </ul>
        ) : null}
      </header>
      <div aria-hidden="true" className="zk-orn mx-4 mt-2" />

      <div data-tour="today-tasks" className="px-2 pb-3 pt-1">
        {!hasSpaces && canCreateSpaces ? (
          <EmptyState
            title={t("today.empty.create_space_title")}
            hint={t("today.empty.create_space_hint")}
            art="empty-tasks"
            action={{ label: t("today.empty.create_space_action"), href: "/projects" }}
          />
        ) : !hasSpaces ? (
          <EmptyState
            title={t("today.empty.no_space_title")}
            hint={t("today.empty.no_space_hint")}
            art="empty-tasks"
            action={{ label: t("today.empty.no_space_action"), href: "/guide/spaces" }}
          />
        ) : counts.open === 0 ? (
          <EmptyState
            title={t("today.empty.title")}
            hint={t("today.empty.hint")}
            art="empty-tasks"
            action={{ label: t("today.empty.action"), href: "/my-work" }}
          />
        ) : (
          <div className="space-y-1">
            {tasks.overdue.length > 0 ? <Group id="today-group-overdue" tone="overdue" title={t("mywork.tab.overdue")} rows={tasks.overdue} total={counts.overdue} /> : null}
            {tasks.today.length > 0 || nothingDueButLater ? (
              <Group id="today-group-today" tone="today" title={t("mywork.tab.today")} rows={tasks.today} total={counts.today} empty={t("today.tasks.nothing_today")} />
            ) : null}
            {tasks.later.length > 0 ? <Group id="today-group-later" tone="later" title={t("today.tasks.later")} rows={tasks.later} total={counts.later} /> : null}
          </div>
        )}
        {quickAdd ? <TodayQuickAdd quickAdd={quickAdd} timeZone={timeZone} /> : null}
      </div>
    </section>
  );
}

/** A count and its word, as a small pill; only the late ones are drawn in the danger colour. */
function Chip({ tone, count, label }: { tone: "danger" | "plain"; count: number; label: string }) {
  return (
    <li
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
        tone === "danger" ? "border-danger/40 text-danger" : "border-border text-fg-muted",
      )}
    >
      <span>{fmtNumber(count)}</span>
      <span>{label}</span>
    </li>
  );
}

function Group({
  id,
  tone,
  title,
  rows,
  total,
  empty,
}: {
  id: string;
  tone: RowTone;
  title: string;
  rows: TodayTask[];
  total: number;
  /** What to say when the group has no rows. */
  empty?: string;
}) {
  const { t } = getServerT();
  const rest = total - rows.length;
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className={cn("flex items-center gap-2 px-2 pb-1 pt-3 font-sans text-xs font-semibold", tone === "overdue" ? "text-danger" : "text-fg-muted")}>
        {tone === "overdue" ? <TriangleAlert className="size-4" aria-hidden="true" /> : null}
        <span>{title}</span>
      </h3>
      {rows.length > 0 ? (
        <ul role="list" className="divide-y divide-border">
          {rows.map((row) => (
            <TodayTaskRow key={row.id} task={row} tone={tone} />
          ))}
        </ul>
      ) : (
        <p className="px-3 pb-2 text-sm text-fg-muted">{empty}</p>
      )}
      {rest > 0 ? (
        <Link href={REST_HREF[tone]} className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-accent hover:underline">
          {t("today.tasks.show_rest", { n: rest })}
        </Link>
      ) : null}
    </section>
  );
}
