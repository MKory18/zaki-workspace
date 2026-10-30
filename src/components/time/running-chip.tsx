import { Timer } from "lucide-react";
import { tt } from "@/lib/time-client";
import { cn } from "@/lib/utils";

/**
 * The little «الوقت شغّال» a row or a card of a task wears while the PERSON's own timer is running on it. It draws nothing
 * otherwise, so a screen can place it unconditionally. Only the person's own timer: nobody sees whose clock is running.
 */
export function RunningChip({ running, className }: { running: boolean | null | undefined; className?: string }) {
  if (!running) return null;
  return (
    <span data-time-running-chip className={cn("flex shrink-0 items-center gap-1 text-xs font-medium text-ok", className)} aria-label={tt("tt.running_chip_aria")} title={tt("tt.running_chip_aria")}>
      <Timer className="h-3 w-3" aria-hidden="true" />
      {tt("tt.running_chip")}
    </span>
  );
}
