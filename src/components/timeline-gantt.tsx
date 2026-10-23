"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarRange, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmtDMY, fmtShort, monthName } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface GanttProject {
  id: string;
  name: string;
  startDate: string | null;
  targetDate: string | null;
}
export interface GanttTask {
  id: string;
  title: string;
  start: string;
  end: string;
  done: boolean;
  priority: string;
  assignee: string | null;
}
export interface GanttMilestone {
  id: string;
  name: string;
  date: string | null;
  status: string;
}

const DAY = 86_400_000;

function dayStart(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const SCALES = [
  { key: "day", pxPerDay: 44 },
  { key: "week", pxPerDay: 14 },
  { key: "month", pxPerDay: 5 },
] as const;

/** Gantt: date axis left→right (dir=ltr inside), task rows, today marker, milestone diamonds. */
export function TimelineGantt({
  project,
  tasks,
  milestones,
  undated,
}: {
  project: GanttProject;
  tasks: GanttTask[];
  milestones: GanttMilestone[];
  undated: { id: string; title: string }[];
}) {
  const { t } = useI18n();
  const [scaleKey, setScaleKey] = useState<(typeof SCALES)[number]["key"]>("week");
  // restore saved zoom after mount (never during SSR/hydration)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("gantt_scale");
      if (saved === "day" || saved === "week" || saved === "month") setScaleKey(saved);
    } catch {}
  }, []);
  const scale = SCALES.find((s) => s.key === scaleKey) ?? SCALES[1];

  const { min, max } = useMemo(() => {
    const points: number[] = [];
    if (project.startDate) points.push(dayStart(new Date(project.startDate).getTime()));
    if (project.targetDate) points.push(dayStart(new Date(project.targetDate).getTime()));
    for (const task of tasks) {
      points.push(dayStart(new Date(task.start).getTime()));
      points.push(dayStart(new Date(task.end).getTime()));
    }
    for (const m of milestones) if (m.date) points.push(dayStart(new Date(m.date).getTime()));
    points.push(dayStart(Date.now()));
    const today = dayStart(Date.now());
    const minPoint = points.length ? Math.min(...points) : today;
    const maxPoint = points.length ? Math.max(...points) : today + 30 * DAY;
    // pad: 3 days left, 7 right; guarantee ≥30-day window
    let lo = minPoint - 3 * DAY;
    let hi = Math.max(maxPoint + 7 * DAY, lo + 30 * DAY);
    if (hi - lo < 30 * DAY) hi = lo + 30 * DAY;
    return { min: lo, max: hi };
  }, [project.startDate, project.targetDate, tasks, milestones]);

  const days = Math.max(1, Math.round((max - min) / DAY));
  const width = days * scale.pxPerDay;
  const todayOffset = Math.min(days, Math.max(0, Math.round((dayStart(Date.now()) - min) / DAY)));

  // month header ticks
  const ticks = useMemo(() => {
    const out: { left: number; label: string }[] = [];
    const d = new Date(min);
    d.setDate(1);
    if (d.getTime() < min) d.setMonth(d.getMonth() + 1);
    while (d.getTime() <= max) {
      const left = Math.round((d.getTime() - min) / DAY) * scale.pxPerDay;
      out.push({
        left,
        label: `${monthName(d.getMonth())} ${d.getFullYear()}`,
      });
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [min, max, scale]);

  const barFor = (task: GanttTask) => {
    const s = dayStart(new Date(task.start).getTime());
    const e = dayStart(new Date(task.end).getTime());
    const start = Math.max(0, Math.round((s - min) / DAY) * scale.pxPerDay);
    const end = Math.min(days, Math.round((e - min) / DAY) + 1) * scale.pxPerDay;
    return { left: start, width: Math.max(scale.pxPerDay, end - start) };
  };

  const milestoneAt = (m: GanttMilestone) =>
    Math.max(0, Math.min(days, Math.round(((m.date ? dayStart(new Date(m.date).getTime()) : min) - min) / DAY))) *
    scale.pxPerDay;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-fg">
            <CalendarRange className="size-5 text-accent" />
            {t("timeline.title")}
          </h1>
          <p className="text-xs text-fg-muted">
            <Link href={`/projects/${project.id}`} className="hover:text-accent">
              {project.name}
            </Link>
              {project.startDate && project.targetDate ? (
              <span className="mx-2">
                {fmtDMY(project.startDate)} ← {fmtDMY(project.targetDate)}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
          {SCALES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setScaleKey(s.key);
                try {
                  window.localStorage.setItem("gantt_scale", s.key);
                } catch {}
              }}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                scaleKey === s.key ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface-2",
              )}
            >
              {t(`timeline.scale_${s.key}`)}
            </button>
          ))}
        </div>
      </header>

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        <div dir="ltr" className="overflow-x-auto">
          <div className="relative" style={{ width }}>
            {/* month axis */}
            <div className="sticky top-0 z-10 h-8 border-b border-border bg-surface">
              {ticks.map((tick, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-8 border-s border-border px-1.5 text-xs leading-8 text-muted"
                  style={{ left: tick.left }}
                >
                  {tick.label}
                </div>
              ))}
            </div>

            {/* project window */}
            {project.startDate && project.targetDate ? (
              <div
                className="absolute top-8 bottom-0 bg-info/5 border-x border-dashed border-info/50"
                style={{
                  left: (
                    Math.max(0, Math.round((dayStart(new Date(project.startDate).getTime()) - min) / DAY)) * scale.pxPerDay
                  ),
                  width: Math.max(
                    scale.pxPerDay,
                    Math.min(
                      days,
                      Math.round((dayStart(new Date(project.targetDate).getTime()) - min) / DAY) + 1,
                    ) *
                      scale.pxPerDay -
                      Math.max(0, Math.round((dayStart(new Date(project.startDate).getTime()) - min) / DAY)) * scale.pxPerDay,
                  ),
                }}
                title={t("timeline.window")}
              />
            ) : null}

            {/* today marker */}
            <div
              className="absolute top-8 bottom-0 w-px bg-accent/60"
              style={{ left: todayOffset * scale.pxPerDay }}
              title={t("timeline.today")}
            >
              <span className="absolute -top-0 -start-1 size-1.5 rounded-full bg-accent" />
            </div>

            {/* task rows */}
            <div className="relative">
              {tasks.map((task, i) => {
                const bar = barFor(task);
                return (
                  <div
                    key={task.id}
                    className={cn("group relative h-9 border-b border-border/60", i % 2 === 0 && "bg-surface-1/40")}
                  >
                    <span
                      className={cn(
                        "absolute top-1.5 z-[1] h-6 rounded-md",
                        task.done
                          ? "bg-ok/90"
                          : new Date(task.end).getTime() < Date.now()
                            ? "bg-danger/80"
                            : task.priority === "URGENT" || task.priority === "HIGH"
                              ? "bg-warn/90"
                              : "bg-info/85",
                      )}
                      style={{ left: bar.left, width: bar.width }}
                      title={`${task.title} — ${fmtDMY(task.start)} ← ${fmtDMY(task.end)}${task.assignee ? ` · ${task.assignee}` : ""}`}
                    >
                      {bar.width > 90 ? (
                        <span className="block max-w-full truncate px-2 pt-0.5 text-xs font-medium leading-5 text-fg">
                          {task.title}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
              {/* milestones across rows */}
              {milestones.map((m) => (
                <span
                  key={m.id}
                  className="absolute z-[2] size-2.5 rotate-45 bg-cat-2 ring-2 ring-white"
                  style={{ left: milestoneAt(m) - 5, top: 4 }}
                  title={`${m.name} — ${m.date ? fmtDMY(m.date) : ""}`}
                />
              ))}
              {tasks.length === 0 && milestones.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted">{t("timeline.empty")}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {undated.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface-1 px-4 py-3">
          <p className="mb-1 text-xs font-semibold text-fg-muted">{t("timeline.undated")}</p>
          <ul className="space-y-0.5">
            {undated.map((task) => (
              <li key={task.id} className="flex items-center gap-1 text-xs text-muted">
                <ChevronRight className="size-3 shrink-0 rtl:rotate-180" />
                <Link href={`/tasks/${task.id}`} className="max-w-md truncate hover:text-accent">
                  {task.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="flex flex-wrap gap-3 text-xs text-muted">
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm bg-info" />{t("timeline.legend_active")}</span>
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm bg-warn" />{t("timeline.legend_priority")}</span>
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm bg-ok" />{t("timeline.legend_done")}</span>
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm bg-danger" />{t("timeline.legend_late")}</span>
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rotate-45 bg-cat-2" />{t("timeline.legend_milestone")}</span>
      </p>
    </div>
  );
}
