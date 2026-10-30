import { rt } from "@/lib/reminders/client";
import { cn } from "@/lib/utils";

/**
 * «🔁 متكررة»: the little mark a card and a row carry when the task belongs to a running series. It draws nothing unless
 * told the task is recurring, so a screen can place it unconditionally; the page hands the flag over only while the
 * company's «مهمة متكررة» switch is on.
 */
export function RecurringBadge({ recurring, className }: { recurring: boolean | null | undefined; className?: string }) {
  if (!recurring) return null;
  return (
    <span data-recurring-badge className={cn("flex shrink-0 items-center gap-1 text-xs text-info", className)} title={rt("recurring.badge_aria")} aria-label={rt("recurring.badge_aria")}>
      <span aria-hidden="true">🔁</span>
      {rt("recurring.badge")}
    </span>
  );
}
