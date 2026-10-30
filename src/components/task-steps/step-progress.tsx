import { ListChecks } from "lucide-react";
import { rt } from "@/lib/reminders/client";
import { cn } from "@/lib/utils";
import type { StepProgress } from "@/lib/task-steps";

/**
 * The little «3 من 5» a card, a row and the task page show when a task has steps. It draws nothing for a task
 * without steps, so a screen can place it unconditionally. Done is the `ok` colour, never a decoration.
 */
export function StepProgressChip({ progress, className }: { progress: StepProgress | null | undefined; className?: string }) {
  if (!progress || progress.total <= 0) return null;
  const complete = progress.done >= progress.total;
  return (
    <span
      data-step-progress
      className={cn("flex shrink-0 items-center gap-1 text-xs", complete ? "text-ok" : "text-muted", className)}
      aria-label={rt("steps.progress_aria", { done: progress.done, total: progress.total })}
      title={rt("steps.progress_aria", { done: progress.done, total: progress.total })}
    >
      <ListChecks className="h-3 w-3" aria-hidden="true" />
      {rt("steps.progress", { done: progress.done, total: progress.total })}
    </span>
  );
}
