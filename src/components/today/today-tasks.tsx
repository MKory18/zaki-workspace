import Link from "next/link";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/card";
import { fmtNumber } from "@/lib/format";
import { getServerT } from "@/lib/i18n/server";
import type { TodayQuickAddData, TodayTask, TodayTasks } from "@/lib/today";
import { cn } from "@/lib/utils";
import { QuickAddInline } from "./quick-add";
import { TodayTaskRow, type RowTone } from "./today-task-row";

/** Where «عرض الباقي» of each group goes: the tab of «مهامي» that holds the rest. */
const REST_HREF: Record<RowTone, string> = {
  overdue: "/my-work?tab=overdue",
  today: "/my-work?tab=today",
  later: "/my-work?tab=mine",
};

/**
 * «مهمّاتي اليوم»: the person's open tasks in three groups, «متأخرة» (due before today), «اليوم» and
 * «لاحقًا» (the next few, with a due date or none), each row finishable with one press — in the
 * adopted mockup's card: the title, the star divider, the list, and the one-line quick add under it.
 *
 * - The list container carries the tour's hook `today-tasks`, whether or not there is anything in it.
 *   Somebody who may open a space of their own (the owner of a new company, above all) is told to open
 *   the first one; everybody else is told that the owner puts people in spaces, and where to read
 *   about them.
 * - Nothing in it is a decoration: it is a list somebody reads every day. The star divider is a rule
 *   between the title and the list, never behind a number.
 * - Colour means something here: the danger colour is for what is late, and only for that.
 */
export function TodayTasksCard({
  tasks,
  hasSpaces,
  canCreateSpaces = false,
  quickAdd = null,
  timeZone,
}: {
  tasks: TodayTasks;
  hasSpaces: boolean;
  canCreateSpaces?: boolean;
  /** The inline field under the list (draws nothing when the person may not add tasks). */
  quickAdd?: TodayQuickAddData | null;
  timeZone: string;
}) {
  const { t } = getServerT();
  const { counts } = tasks;
  const nothingDueButLater = counts.open > 0 && counts.overdue === 0 && counts.today === 0;

  return (
    <section aria-labelledby="today-tasks-title" className="rounded-[18px] border border-border bg-surface-1 p-[18px]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="today-tasks-title" className="font-display text-lg font-bold leading-tight text-fg">
          {t("today.tasks.title")}
        </h2>
        {counts.open > 0 ? (
          <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[13px] font-medium text-muted">{t("today.count", { n: counts.open })}</span>
        ) : null}
        {counts.open > 0 ? (
          <Link href="/my-work" className="ms-auto inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent hover:underline">
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

      <div aria-hidden="true" className="zk-orn my-2" />

      <div data-tour="today-tasks" className="px-0">
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
          <div>
            {tasks.overdue.length > 0 ? <Group id="today-group-overdue" tone="overdue" title={t("mywork.tab.overdue")} rows={tasks.overdue} total={counts.overdue} /> : null}
            {tasks.today.length > 0 || nothingDueButLater ? (
              <Group id="today-group-today" tone="today" title={t("mywork.tab.today")} rows={tasks.today} total={counts.today} empty={t("today.tasks.nothing_today")} />
            ) : null}
            {tasks.later.length > 0 ? <Group id="today-group-later" tone="later" title={t("today.tasks.later")} rows={tasks.later} total={counts.later} /> : null}
          </div>
        )}
        {quickAdd && quickAdd.targets.length > 0 ? <QuickAddInline quickAdd={quickAdd} timeZone={timeZone} /> : null}
      </div>
    </section>
  );
}

/** A count and its word, as a small pill; only the late ones are drawn in the danger colour. */
function Chip({ tone, count, label }: { tone: "danger" | "plain"; count: number; label: string }) {
  return (
    <li
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium",
        tone === "danger" ? "text-danger" : "text-muted",
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
      <h3 id={id} className={cn("flex items-center gap-1.5 px-1.5 pb-1 pt-2 font-sans text-xs font-bold", tone === "overdue" ? "text-danger" : "text-muted")}>
        {tone === "overdue" ? <TriangleAlert className="size-3.5" aria-hidden="true" /> : null}
        <span>{title}</span>
      </h3>
      {rows.length > 0 ? (
        <ul role="list">
          {rows.map((row) => (
            <TodayTaskRow key={row.id} task={row} tone={tone} />
          ))}
        </ul>
      ) : (
        <p className="px-1.5 py-2 text-sm text-muted">{empty}</p>
      )}
      {rest > 0 ? (
        <Link href={REST_HREF[tone]} className="inline-flex min-h-11 items-center px-1.5 text-sm font-semibold text-accent hover:underline">
          {t("today.tasks.show_rest", { n: rest })}
        </Link>
      ) : null}
    </section>
  );
}
