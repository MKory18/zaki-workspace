"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import type { TodayTask } from "@/lib/today";
import { cn } from "@/lib/utils";
import { completeTask } from "./complete-task";

/** Which group the row sits in: it decides how the due day is drawn. */
export type RowTone = "overdue" | "today" | "later";

/** Only the two priorities that ask for attention get a mark: a calm list does not label every row «عادية». */
const PRIORITY_MARK: Partial<Record<string, string>> = {
  URGENT: "text-danger",
  HIGH: "text-warn",
};

/**
 * One task of «مهمّاتي اليوم», in the mockup's shape: a 30px circle that fills with the gold star
 * when the task is finished, and beside it the title over its project, its day and its priority.
 *
 * - The circle is a 44px target around a 30px drawing, and it is there only when the person may
 *   change the task. Pressing it is OPTIMISTIC: the star appears at once,
 *   `POST /api/tasks/<id>/complete` goes out, and on success the page is refreshed (the task leaves
 *   the list); if the server says no, the row comes back and the reason is said in Arabic in a toast.
 * - The due day arrives already written (in the company's zone, by the server), so this part does no
 *   date maths and cannot disagree with the server about what «اليوم» is.
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
    <li className="zk-task flex items-center gap-3 rounded-xl px-1.5 py-2.5 transition-colors hover:bg-surface-2">
      {task.editable ? (
        <button
          type="button"
          onClick={complete}
          disabled={done}
          aria-label={t("today.done_aria", { title: task.title })}
          className="group/done grid size-11 shrink-0 place-items-center rounded-full"
        >
          <span className={cn("zk-check", done && "zk-check-done")}>
            <span
              aria-hidden="true"
              className={cn(
                "zk-star size-[18px] text-accent-2 transition-transform duration-300 motion-reduce:transition-none",
                done ? "scale-100" : "scale-0 group-hover/done:scale-100",
              )}
            />
          </span>
        </button>
      ) : (
        <span aria-hidden="true" className="size-11 shrink-0" />
      )}
      <Link
        href={`/tasks/${task.id}`}
        prefetch={false}
        className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-lg py-0.5"
      >
        <span className={cn("truncate text-[15px] font-semibold leading-6", done ? "text-muted line-through decoration-accent-2" : "text-fg")}>
          <bdi>{task.title}</bdi>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5 text-muted">
          <span className="min-w-0 max-w-full truncate">
            <bdi>{task.projectName}</bdi>
          </span>
          {showDue ? (
            <>
              <span aria-hidden="true">·</span>
              <span className={tone === "overdue" ? "text-danger" : undefined}>{task.dueLabel}</span>
            </>
          ) : null}
          {mark ? <span className={cn("rounded-md border border-border px-2 text-xs font-medium", mark)}>{task.priorityLabel}</span> : null}
        </span>
      </Link>
    </li>
  );
}
