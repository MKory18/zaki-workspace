import { Lightbulb } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getServerT } from "@/lib/i18n/server";
import { tipForAudience, tipSeed } from "@/lib/tips";

/**
 * What Next.js shows in place of a page of the app while it loads: a calm skeleton of a page, painted
 * with the theme's own tokens, and ONE usage tip. The shell around it stays where it is.
 *
 * - The tip comes from the clock, `tipForAudience(tipSeed(now), "everyone")` (it changes every 30 seconds): a pure function of
 *   a number, never Math.random, so the same moment gives the same tip. This is a server component, so it
 *   is rendered once, on the server, and the browser never re-renders it: nothing to mismatch.
 * - The skeleton is decoration (hidden from screen readers); what a screen reader gets is "جارٍ التحميل…"
 *   and the tip. Under `prefers-reduced-motion` the blocks hold still.
 * - Ornaments are allowed on loading screens (see the decoration rules in the Phase 2 plan); none is
 *   drawn yet. When the theme decoration component exists it goes inside the tip card, never behind text
 *   without a scrim.
 */
export default function Loading() {
  const { t } = getServerT();
  // The safest list, for EVERYBODY: a loading fallback is painted before the page knows who is
  // looking (and must not do a database read to find out), so it never promises a guest the chat or
  // the library — the two tips the server refuses an external partner.
  const tip = t(tipForAudience(tipSeed(Date.now()), "everyone"));

  return (
    <div role="status" aria-live="polite" aria-busy="true" className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-5 p-4 md:p-6">
      <span className="sr-only">{t("common.loading")}</span>

      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-6 w-40 max-w-full" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-1 p-4">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Lightbulb className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg-muted">{t("tips.heading")}</p>
          <p className="mt-1 text-sm leading-6 text-fg">{tip}</p>
        </div>
      </div>

      <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>

      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}
