import Link from "next/link";
import { Download } from "lucide-react";
import { enumLabel } from "@/lib/i18n/enums";
import { bothText, dayLabel, tt } from "@/lib/time-client";
import { formatDecimal, formatHM, type Group } from "@/lib/time-tracking";
import type { TimeReport } from "@/server/services/time-tracking";

/**
 * «تقرير الوقت» — drawn from one `TimeReport` of the service. Pure markup, no hooks: the filters are a plain GET form (the
 * page reads them back from the address), so the report works without a script and renders in a test.
 *
 * The hours are shown as `hh:mm` AND as a two-digit decimal, both from the INTEGER seconds of the rows (the totals are
 * integer sums made by the server, never a float accumulated here). No money anywhere.
 */

const selectCls = "min-h-11 md:h-8 rounded-lg border border-muted bg-surface-1 px-2 text-base md:text-xs text-fg";
const inputCls = "min-h-11 md:h-8 rounded-lg border border-muted bg-surface-1 px-2 text-base md:text-xs text-fg";

function GroupTable({ title, groups, labelOf }: { title: string; groups: Group[]; labelOf: (g: Group) => string }) {
  if (groups.length === 0) return null;
  return (
    <section className="rounded-card border border-border bg-surface-1">
      <h3 className="border-b border-border px-4 py-2 text-sm font-semibold text-fg">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {groups.map((g) => (
            <tr key={g.key} data-group={g.key} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2 text-fg">{labelOf(g)}</td>
              <td className="px-4 py-2 text-end tabular-nums text-fg" aria-label={tt("tt.report.hm_aria", { hm: formatHM(g.seconds), decimal: formatDecimal(g.seconds) })}>
                {bothText(g.seconds)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export interface ReportView {
  report: TimeReport;
  /** The address of the CSV of exactly this report. */
  csvHref: string;
  presets: { week: { from: string; to: string }; month: { from: string; to: string } };
  /** What the form showed for the space (`all` for every space of theirs). */
  spaceValue: string;
}

export function TimeReportView({ report, csvHref, presets, spaceValue }: ReportView) {
  const f = report.filters;
  const keep = (range: { from: string; to: string }) => {
    const p = new URLSearchParams({ from: range.from, to: range.to });
    if (f.userId) p.set("userId", f.userId);
    if (f.projectId) p.set("projectId", f.projectId);
    if (f.taskId) p.set("taskId", f.taskId);
    p.set("workspaceId", spaceValue);
    return `/time?${p.toString()}`;
  };
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4 md:px-6 md:py-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-fg">{tt("tt.report.title")}</h1>
        <p className="text-xs text-fg-muted">{tt("tt.report.subtitle")}</p>
      </header>

      <form method="get" action="/time" data-report-filters aria-label={tt("tt.report.filters")} className="flex flex-wrap items-end gap-2 rounded-card border border-border bg-surface-1 p-3">
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {tt("tt.report.from")}
          <input type="date" name="from" defaultValue={report.from} dir="ltr" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {tt("tt.report.to")}
          <input type="date" name="to" defaultValue={report.to} dir="ltr" className={inputCls} />
        </label>
        {report.canPickPerson ? (
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {tt("tt.report.person")}
            <select name="userId" defaultValue={f.userId ?? ""} className={selectCls}>
              <option value="">{tt("tt.report.all_people")}</option>
              {report.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="pb-2 text-xs text-fg-muted">{tt("tt.report.only_me")}</p>
        )}
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {tt("tt.report.project")}
          <select name="projectId" defaultValue={f.projectId ?? ""} className={selectCls}>
            <option value="">{tt("tt.report.all_projects")}</option>
            {report.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {report.spaces.length > 1 ? (
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {tt("tt.report.space")}
            <select name="workspaceId" defaultValue={spaceValue} className={selectCls}>
              <option value="all">{tt("tt.report.all_spaces")}</option>
              {report.spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="workspaceId" value={spaceValue} />
        )}
        {f.taskId ? <input type="hidden" name="taskId" value={f.taskId} /> : null}
        <button type="submit" className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent/90 md:h-8 md:min-h-0">
          {tt("tt.report.apply")}
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Link href={keep(presets.week)} className="text-accent underline-offset-2 hover:underline">
          {tt("tt.report.week")}
        </Link>
        <Link href={keep(presets.month)} className="text-accent underline-offset-2 hover:underline">
          {tt("tt.report.month")}
        </Link>
        {f.taskId ? (
          <span className="flex items-center gap-1 rounded bg-surface-2 px-2 py-1 text-fg-muted">
            {tt("tt.report.task_filter")}
            <Link
              href={`/time?${new URLSearchParams({ from: report.from, to: report.to, workspaceId: spaceValue }).toString()}`}
              className="text-accent underline-offset-2 hover:underline"
            >
              {tt("tt.report.clear_task")}
            </Link>
          </span>
        ) : null}
        <a href={csvHref} download className="ms-auto inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline">
          <Download className="h-3.5 w-3.5" aria-hidden="true" /> {tt("tt.report.csv")}
        </a>
      </div>

      <section className="rounded-card border border-border bg-surface-1 px-4 py-3">
        <p className="text-xs text-fg-muted">{tt("tt.report.total")}</p>
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span data-report-total className="text-2xl font-semibold tabular-nums text-fg" aria-label={tt("tt.report.hm_aria", { hm: formatHM(report.totalSeconds), decimal: formatDecimal(report.totalSeconds) })}>
            {formatHM(report.totalSeconds)}
          </span>
          <span className="text-sm tabular-nums text-fg-muted">{formatDecimal(report.totalSeconds)}</span>
        </p>
      </section>

      {report.rows.length === 0 ? (
        <p className="rounded-card border border-border bg-surface-1 px-4 py-6 text-center text-sm text-fg-muted">{tt("tt.report.empty")}</p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <GroupTable title={tt("tt.report.by_person")} groups={report.byPerson} labelOf={(g) => g.label} />
            <GroupTable title={tt("tt.report.by_project")} groups={report.byProject} labelOf={(g) => (g.key === "none" ? tt("tt.report.no_project") : g.label)} />
            <GroupTable title={tt("tt.report.by_day")} groups={report.byDay} labelOf={(g) => dayLabel(g.key)} />
          </div>

          <section className="overflow-x-auto rounded-card border border-border bg-surface-1">
            <h3 className="border-b border-border px-4 py-2 text-sm font-semibold text-fg">{tt("tt.report.entries")}</h3>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-fg-muted">
                  {["day", "person", "project", "task", "hm", "decimal", "note", "source"].map((c) => (
                    <th key={c} scope="col" className="px-3 py-2 text-start font-medium">
                      {tt(`tt.report.col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.id} data-entry={r.id} className="border-b border-border/60 align-top last:border-0">
                    <td className="px-3 py-2 text-fg">{dayLabel(r.day)}</td>
                    <td className="px-3 py-2 text-fg">{r.userName}</td>
                    <td className="px-3 py-2 text-fg-muted">{r.projectName ?? tt("tt.report.no_project")}</td>
                    <td className="px-3 py-2 text-fg">
                      {r.taskId ? (
                        <Link href={`/tasks/${r.taskId}`} className="text-accent underline-offset-2 hover:underline">
                          {r.taskTitle}
                        </Link>
                      ) : (
                        r.taskTitle
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-fg">{formatHM(r.seconds)}</td>
                    <td className="px-3 py-2 tabular-nums text-fg-muted">{formatDecimal(r.seconds)}</td>
                    <td className="max-w-[16rem] break-words px-3 py-2 text-xs text-fg-muted">{r.note}</td>
                    <td className="px-3 py-2 text-xs text-fg-muted">
                      {enumLabel("TimeEntrySource", r.source)}
                      {r.autoStopped ? (
                        <span className="block text-warn">
                          <span aria-hidden="true">⚠️ </span>
                          {tt("tt.auto_stopped")}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <div className="space-y-0.5 text-xs text-fg-muted">
        <p>
          <span aria-hidden="true">⚠️ </span>
          {tt("tt.report.warn")}
        </p>
        <p>
          <span aria-hidden="true">🔧 </span>
          {tt("tt.report.fix")}
        </p>
      </div>
    </div>
  );
}
