"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";
import { apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { PRIORITY_STYLES, fmtDMY, fmtRelative } from "@/lib/format";
import { dayOfInstant } from "@/lib/due-day";
import { columnLabel, enumLabel } from "@/lib/i18n/enums";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import Link from "next/link";
export interface RowTask {
  id: string;
  key: string;
  title: string;
  priority: string;
  dueDate: Date | string | null;
  completedAt: Date | string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  projectName?: string;
  columnName?: string;
  /** The due day as the company reads it (`YYYY-MM-DD`) — what the date box shows; without it the row derives it in the company's zone. */
  dueDay?: string | null;
}

export interface RowMember {
  id: string;
  name: string;
}

/** Compact inline-actionable task row; same data everywhere (My Work / List). */
export function TaskRow({
  task,
  members,
  editable,
  showProject = false,
  showColumn = false,
  timeZone,
}: {
  task: RowTask;
  members?: RowMember[];
  editable: boolean;
  showProject?: boolean;
  showColumn?: boolean;
  /** The company's zone: the day a person picks is that zone's day, never the browser's (review B5). */
  timeZone: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const done = task.completedAt != null;
  const [busy, setBusy] = useState(false);
  const priorityColor = PRIORITY_STYLES[task.priority]?.color ?? "rgb(var(--border))";

  function fail(err: unknown) {
    const code = err instanceof ApiError ? err.code : "internal";
    toast(code === "forbidden" ? t("forbidden") : t("common.error"), "error");
  }

  async function toggleComplete() {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost(`/api/tasks/${task.id}/complete`, { complete: !done });
      toast(t("task.updated"), "success");
      router.refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function changeDue(value: string) {
    if (busy) return;
    setBusy(true);
    try {
      // the day as picked (`YYYY-MM-DD`): the server turns it into noon in the COMPANY's zone. Building the
      // instant here meant the browser's clock decided which day was saved (review B5).
      await apiPatch(`/api/tasks/${task.id}`, {
        dueDate: value === "" ? null : value,
      });
      toast(t("task.updated"), "success");
      router.refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function changeAssignee(value: string) {
    if (busy) return;
    setBusy(true);
    try {
      await apiPatch(`/api/tasks/${task.id}`, { assigneeId: value === "" ? null : value });
      toast(t("task.updated"), "success");
      router.refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const dueValue = task.dueDay ?? (task.dueDate ? dayOfInstant(task.dueDate, timeZone) : "");

  return (
    <li className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
      <button
        type="button"
        disabled={!editable || busy}
        onClick={toggleComplete}
        aria-label={done ? t("task.reopen") : t("task.complete")}
        title={done ? t("task.reopen") : t("task.complete")}
        className={cn(
          "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors",
          done
            ? "border-ok bg-ok text-ok-fg"
            : "border-muted/50 hover:border-ok",
          (!editable || busy) && "opacity-40",
        )}
      >
        {done ? <Check className="h-3 w-3" /> : null}
      </button>

      <Link href={`/tasks/${task.id}`} className="flex min-w-0 flex-1 items-center gap-2">
        <span dir="ltr" className="shrink-0 font-mono text-xs text-muted">{task.key}</span>
        <span className={cn("truncate text-sm", done ? "text-muted line-through" : "text-fg")}>
          {task.title}
        </span>
        {showProject && task.projectName ? (
          <span className="hidden shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted md:inline">
            {task.projectName}
          </span>
        ) : null}
        {showColumn && task.columnName ? (
          <span className="hidden shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted md:inline">
            {columnLabel(task.columnName)}
          </span>
        ) : null}
      </Link>

      <span
        role="img"
        aria-label={`${t("task.priority")}: ${enumLabel("TaskPriority", task.priority)}`}
        title={enumLabel("TaskPriority", task.priority)}
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: priorityColor }}
      />

      {editable ? (
        <input
          type="date"
          aria-label={t("task.due")}
          defaultValue={dueValue}
          onChange={(e) => changeDue(e.target.value)}
          className="w-28 shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-fg-muted hover:border-border focus:border-border focus:outline-none"
        />
      ) : (
        <span
          className="w-28 shrink-0 text-xs text-fg-muted"
          title={task.dueDate ? fmtDMY(task.dueDate) : undefined}
          suppressHydrationWarning
        >
          {task.dueDate ? fmtRelative(task.dueDate) : ""}
        </span>
      )}

      {members && editable ? (
        <select
          aria-label={t("task.assignee")}
          value={task.assigneeId ?? ""}
          disabled={busy}
          onChange={(e) => changeAssignee(e.target.value)}
          className="max-w-28 shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-fg-muted hover:border-border focus:border-border focus:outline-none"
        >
          <option value="">{t("list.unassigned")}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="w-20 shrink-0 truncate text-xs text-muted" title={task.assigneeName ?? ""}>
          {task.assigneeName ?? ""}
        </span>
      )}
    </li>
  );
}
