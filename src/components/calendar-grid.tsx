"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPatch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { weekdayName } from "@/lib/format";

export interface CalTask {
  id: string;
  key: string;
  title: string;
  dueDate: string;
}

function toLocalNoonISO(dayIso: string): string {
  const [y, m, d] = dayIso.split("-").map(Number);
  if (!y || !m || !d) return dayIso;
  return new Date(y, m - 1, d, 12).toISOString();
}

/** Month grid with drag-to-reschedule. Drops persist via PATCH /api/tasks/[id]. */
export function CalendarGrid({
  month,
  tasks,
  todayIso,
  editable,
}: {
  month: string; // YYYY-MM
  tasks: CalTask[];
  todayIso: string;
  editable: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const [year, monthIdx] = (() => {
    const [y, m] = month.split("-").map(Number);
    if (!y || !m || m < 1 || m > 12) {
      const now = new Date();
      return [now.getUTCFullYear(), now.getUTCMonth() + 1];
    }
    return [y, m];
  })();
  const first = new Date(Date.UTC(year, monthIdx - 1, 1));
  const startOffset = first.getUTCDay(); // Sunday-start grid
  const dayCount = new Date(Date.UTC(year, monthIdx, 0)).getUTCDate();

  const byDay = new Map<string, CalTask[]>();
  for (const task of tasks) {
    const key = task.dueDate.slice(0, 10);
    const arr = byDay.get(key) ?? [];
    arr.push(task);
    byDay.set(key, arr);
  }

  const weekdayLabels = Array.from({ length: 7 }, (_, i) => weekdayName(i, locale));

  async function handleDrop(taskId: string, dayIso: string) {
    setDragId(null);
    setOverKey(null);
    try {
      await apiPatch(`/api/tasks/${taskId}`, { dueDate: toLocalNoonISO(dayIso) });
      toast(t("task.updated"), "success");
      router.refresh();
    } catch {
      toast(t("common.error"), "error");
    }
  }

  const cells: { iso: string; day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(Date.UTC(year, monthIdx - 1, 1 - startOffset + i));
    cells.push({
      iso: d.toISOString().slice(0, 10),
      day: d.getUTCDate(),
      inMonth: (i - startOffset) >= 0 && d.getUTCMonth() === monthIdx - 1,
    });
    if (i - startOffset >= dayCount) {
      cells.pop();
      break;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-7 border-b border-border bg-surface px-1 text-center text-[10px] text-muted">
        {weekdayLabels.map((lbl) => (
          <div key={lbl} className="py-1.5">
            {lbl}
          </div>
        ))}
      </div>
      <div className="grid flex-1 auto-rows-fr grid-cols-7 gap-px overflow-y-auto bg-border/50 p-px">
        {cells.map((cell) => {
          const dayTasks = byDay.get(cell.iso) ?? [];
          const isToday = cell.iso === todayIso;
          return (
            <div
              key={cell.iso}
              onDragOver={(e) => {
                if (!editable || !dragId) return;
                e.preventDefault();
                setOverKey(cell.iso);
              }}
              onDrop={() => {
                if (editable && dragId) handleDrop(dragId, cell.iso);
              }}
              className={cn(
                "min-h-20 flex flex-col gap-0.5 rounded-sm bg-surface p-1.5",
                !cell.inMonth && "opacity-40",
                isToday && "ring-1 ring-accent/60",
                overKey === cell.iso && "bg-surface-2",
              )}
            >
              <span className={cn("px-1 text-[10px] text-muted", isToday && "font-bold text-accent")}>
                {cell.day}
              </span>
              <div className="flex-1 space-y-0.5">
                {dayTasks.slice(0, 3).map((task) => (
                  <div
                    key={task.id}
                    draggable={editable}
                    onDragStart={() => setDragId(task.id)}
                    onDragEnd={() => setDragId(null)}
                    title={task.title}
                    className={cn(
                      "cursor-default truncate rounded bg-surface-2 px-1 py-0.5 text-[10px] text-fg",
                      editable && "cursor-grab active:cursor-grabbing",
                      dragId === task.id && "opacity-40",
                    )}
                  >
                    <span className="font-mono text-muted">{task.key}</span> {task.title}
                  </div>
                ))}
                {dayTasks.length > 3 ? (
                  <p className="px-1 text-[10px] text-muted">+{dayTasks.length - 3}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
