"use client";

import * as React from "react";
import { Star } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MAX_STARS } from "@/lib/cards/rating";
import type { RatingView } from "@/lib/cards/page";

const STARS = Array.from({ length: MAX_STARS }, (_, i) => i + 1);

/** Five stars, `filled` of them full. Drawn with the theme's «warn» token; the number is always written beside it. */
function StarRow({ filled, className }: { filled: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center", className)} aria-hidden="true">
      {STARS.map((n) => (
        <Star key={n} className={cn("size-4", n <= filled ? "fill-current text-warn" : "text-fg-muted")} />
      ))}
    </span>
  );
}

/** The card's average and how many people rated (nothing about who). */
export function StarsAverage({ rating }: { rating: Pick<RatingView, "average" | "count"> }) {
  const { t } = useI18n();
  if (rating.average === null) return <span className="text-xs text-fg-muted">{t("cards.p.stars_none")}</span>;
  return (
    <span data-testid="stars-average" className="inline-flex flex-wrap items-center gap-1.5 text-sm text-fg">
      <StarRow filled={Math.round(rating.average)} />
      <span className="font-semibold">{t("cards.p.stars_avg", { avg: String(rating.average) })}</span>
      <span className="text-xs text-fg-muted">{t("cards.p.stars_count", { n: fmtNumber(rating.count) })}</span>
    </span>
  );
}

/** My own stars: five 44px buttons in a radio group (one per person; pressing another number changes it). */
export function StarPicker({ value, onPick, disabled = false }: { value: number | null; onPick: (stars: number) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t("cards.p.stars_mine")} className="inline-flex">
      {STARS.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={t("cards.p.stars_n", { n: fmtNumber(n) })}
          disabled={disabled}
          onClick={() => onPick(n)}
          className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface-2 disabled:opacity-50 motion-reduce:transition-none"
        >
          <Star className={cn("size-6", value !== null && n <= value ? "fill-current text-warn" : "text-fg-muted")} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/** Who gave what: only handed to the owner and the card's creator, and only they are shown the list. */
export function RatersList({ rating }: { rating: RatingView }) {
  const { t } = useI18n();
  if (!rating.raters || rating.raters.length === 0) return null;
  return (
    <section aria-label={t("cards.p.raters")} className="flex flex-col gap-1 rounded-lg border border-border bg-surface-1 p-3">
      <h3 className="text-sm font-semibold text-fg">{t("cards.p.raters")}</h3>
      <p className="text-xs text-fg-muted">{t("cards.p.raters_hint")}</p>
      <ul className="m-0 flex flex-col p-0">
        {rating.raters.map((r) => (
          <li key={r.userId} className="flex min-h-9 list-none items-center justify-between gap-2 text-sm">
            <span dir="auto" className="min-w-0 truncate text-fg">{r.name}</span>
            <span className="inline-flex items-center gap-1.5">
              <StarRow filled={r.stars} />
              <span className="text-xs text-fg-muted">{t("cards.p.stars_n", { n: fmtNumber(r.stars) })}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
