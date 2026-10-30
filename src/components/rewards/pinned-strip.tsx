import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { AR } from "@/lib/i18n/dict";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PinnedCard } from "@/server/services/pinned";
import { PinMark, RewardBadge } from "./reward-badge";

/**
 * «مثبّتة» — the pinned tasks as a strip (the top of a project's page) or as a compact card (the Today page's side column).
 * Static markup: a link per task, with the reward badge for somebody who may see it (the cards carry none for a partner).
 * Nothing is drawn when nothing is pinned.
 */
export function PinnedStrip({ tasks, variant = "strip" }: { tasks: PinnedCard[]; variant?: "strip" | "card" }) {
  if (tasks.length === 0) return null;
  const card = variant === "card";
  return (
    <section
      data-pinned-strip={variant}
      aria-label={AR["pin.strip_aria"] ?? ""}
      className={cn("rounded-xl border border-border bg-surface-1", card ? "p-3" : "p-3 md:p-4")}
    >
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
        <PinMark />
        {AR[card ? "pin.card.title" : "pin.strip"] ?? ""}
      </h2>
      <ul className={cn(card ? "space-y-1" : "grid gap-2 md:grid-cols-2")}>
        {tasks.map((task) => (
          <li key={task.id}>
            <Link
              href={`/tasks/${task.id}`}
              data-pinned-task={task.id}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/60 px-2.5 py-1.5 transition-colors hover:border-accent/40"
            >
              <span dir="ltr" className="shrink-0 font-mono text-xs text-muted">{task.key}</span>
              <span className={cn("min-w-0 flex-1 truncate text-sm text-fg", task.completed && "text-muted line-through")}>{task.title}</span>
              {task.dueDate ? (
                <span className="flex shrink-0 items-center gap-1 text-xs text-fg-muted" suppressHydrationWarning>
                  <CalendarDays className="size-3" aria-hidden />
                  {fmtRelative(task.dueDate)}
                </span>
              ) : null}
              <RewardBadge reward={task.reward} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
