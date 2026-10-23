"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import type { TodayTask } from "@/lib/today";
import { cn } from "@/lib/utils";
import { completeTask } from "./complete-task";

/** Which group the row sits in: it decides how the due day is drawn. */
export type RowTone = "overdue" | "today" | "later";

/** Only the two priorities that ask for attention get a mark: a calm list does not label every row «عادية». */
const PRIORITY_MARK: Partial<Record<string, string>> = {
  URGENT: "border-danger/40 text-danger",
  HIGH: "border-warn/40 text-warn",
};

/**
 * One task of «مهامي اليوم»: the circle at the start finishes it (the guide calls it «الدائرة اللي بأول المهمة»),
 * the rest of the row opens it.
 *
 * - The circle is a 44px target around a 24px drawing, and it is there only when the person may change the
 *   task. Pressing it is OPTIMISTIC: the row is crossed out at once, `POST /api/tasks/<id>/complete` goes out,
 *   and on success the page is refreshed (the task leaves the list); if the server says no, the row comes back
 *   and the reason is said in Arabic in a toast.
 * - The due day arrives already written (in the company's zone, by the server), so this part does no date maths
 *   and cannot disagree with the server about what «اليوم» is. Under «اليوم» it is not repeated on every row.
 */
export function TodayTaskRow({ task, tone }: { task: TodayTask; tone: RowTone }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [done, setDone] = useState(false);

  async function complete() {
    if (done) return;
    setDone(true);
    const result = await completeTask(task.id);
    if (result.ok) {
      toast(t("today.done_toast"), "success");
      router.refresh();
      return;
    }
    setDone(false);
    toast(t(result.messageKey), "error");
  }

  const showDue = task.dueLabel !== "" && tone !== "today";
  const mark = PRIORITY_MARK[task.priority];

  return (
    <li className="flex items-center gap-1">
      {task.editable ? (
        <button
          type="button"
          onClick={complete}
          disabled={done}
          aria-label={t("today.done_aria", { title: task.title })}
          className="group/done flex size-11 shrink-0 items-center justify-center rounded-full"
        >
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full border-2 transition-colors motion-reduce:transition-none",
              done ? "border-ok bg-ok text-ok-fg" : "border-muted text-muted/80 group-hover/done:border-ok group-hover/done:text-ok",
            )}
          >
            <Check className="size-3.5" aria-hidden="true" />
          </span>
        </button>
      ) : null}
      <Link
        href={`/tasks/${task.id}`}
        prefetch={false}
        className={cn("flex min-h-14 min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-lg py-2 transition-colors hover:bg-surface-2", task.editable ? "pe-2 ps-1" : "px-3")}
      >
        <span className={cn("line-clamp-2 break-words text-[15px] font-medium leading-6", done ? "text-fg-muted line-through" : "text-fg")}>
          <bdi>{task.title}</bdi>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-fg-muted">
          <span className="min-w-0 max-w-full truncate">
            <bdi>{task.projectName}</bdi>
          </span>
          {showDue ? (
            <>
              <span aria-hidden="true">·</span>
              <span className={tone === "overdue" ? "text-danger" : undefined}>{task.dueLabel}</span>
            </>
          ) : null}
          {mark ? <span className={cn("rounded-full border px-2 text-xs font-medium", mark)}>{task.priorityLabel}</span> : null}
        </span>
      </Link>
    </li>
  );
}
