import { ArtSlot } from "@/components/theme/art-slot";
import { ThemeDecor } from "@/components/theme/theme-decor";

/**
 * The calm strip at the top of «اليوم»: the greeting and the date, over the theme's ornament (and, in the two
 * Islamic themes, over the owner's `today-strip` picture once its file exists in public/brand/art).
 *
 * This is one of the four places decoration is allowed (see src/lib/themes/decor.ts), and it follows its rules:
 *
 *  - ⚠️ NOTHING THAT IS MEASURED IS DRAWN OVER IT. The strip holds the words and nothing else: no count, no amount,
 *    no link, no button. The numbers of the day are in the cards below, on the page's own colour.
 *  - 🔧 The words sit on a `zk-scrim` panel (the page's own colour, nearly opaque), so what is read never depends on
 *    the picture behind it; only `fg` and `fg-muted` are used over it, the colours the contrast tests hold.
 *  - The layer and the picture are behind the panel (`relative z-10`), `aria-hidden`, and catch no click. Where the
 *    picture is missing nothing is broken: the ornament is what you see.
 *
 * A server component with no state: the greeting and the date arrive written.
 */
export function TodayHero({ greeting, date }: { greeting: string; date: string }) {
  return (
    <section aria-labelledby="today-greeting" className="relative isolate overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
      <ThemeDecor kind="strip" />
      <ArtSlot slot="today-strip" className="zk-strip-art" />
      <div className="relative z-10 flex min-h-28 items-end p-3">
        <div className="zk-scrim max-w-full rounded-xl px-4 py-3">
          <h1 id="today-greeting" className="text-xl font-bold leading-8 text-fg md:text-2xl">
            {greeting}
          </h1>
          <p className="text-sm leading-6 text-fg-muted">{date}</p>
        </div>
      </div>
    </section>
  );
}
