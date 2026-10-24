import Link from "next/link";
import { ArtSlot } from "@/components/theme/art-slot";
import { ThemeDecor } from "@/components/theme/theme-decor";
import { getServerT } from "@/lib/i18n/server";
import type { TodayTask } from "@/lib/today";
import { cn } from "@/lib/utils";
import { MissionDone } from "./mission-done";

/** Only the two priorities that ask for attention get a word on the card, as in the list. */
const PRIORITY_MARK: Partial<Record<string, string>> = {
  URGENT: "border-danger/40 text-danger",
  HIGH: "border-warn/40 text-warn",
};

/**
 * «المهمّة الجاية» — the top of «اليوم» in the shape of «نجمة وطريق»: the one task to do next (`missionOf`:
 * the most overdue, else the first due today) as the page's ONLY heading, with «ابدأ المهمّة» (its page) and
 * «خلّصتها» (MissionDone). With nothing due the card greets instead, and the greeting is the heading.
 *
 * What is behind the card is one of the four places decoration may be drawn (src/lib/themes/decor.ts):
 *  - on «ليل» and «نهار» Amman at dusk (`.zk-hero-photo`, a CSS background: no request on another theme or
 *    with decoration off) over the field of stars; on the other two themes their ornament, and the owner's
 *    `today-strip` picture once its file exists in public/brand/art.
 *  - 🔧 THE RULE, CHANGED ON PURPOSE (the owner adopted the mock-up, 24/10): the old strip held words only, no
 *    link and no button. The mission's two buttons are now on it — but ONLY inside the `zk-scrim` panel, the
 *    page's own colour nearly opaque, so nothing read or pressed depends on the picture. No count, no amount,
 *    no list is drawn here: the numbers of the day stay in the cards below. (tests/today-ui.test.ts holds it.)
 *  - The layer and the picture are `aria-hidden` and catch no click.
 */
export function TodayHero({ greeting, date, mission }: { greeting: string; date: string; mission: TodayTask | null }) {
  const { t } = getServerT();
  const mark = mission ? PRIORITY_MARK[mission.priority] : undefined;
  return (
    <section aria-labelledby="today-mission" className="relative isolate overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
      <ThemeDecor kind="strip" />
      <ArtSlot slot="today-strip" className="zk-strip-art" />
      <div aria-hidden="true" className="zk-hero-photo pointer-events-none absolute inset-0" />
      <div className={cn("relative z-10 flex items-end p-3", mission ? "min-h-52 md:min-h-60" : "min-h-32")}>
        <div className="zk-scrim w-full max-w-xl rounded-xl px-4 py-3">
          {mission ? (
            <p className="mb-2">
              <span className="zk-ribbon text-sm font-bold">
                <span>{t("today.mission.ribbon")}</span>
              </span>
            </p>
          ) : null}
          <h1 id="today-mission" className={cn("break-words text-fg", mission ? "line-clamp-3 font-brand text-3xl leading-tight md:text-4xl" : "text-xl font-bold leading-8 md:text-2xl")}>
            {mission ? <bdi>{mission.title}</bdi> : greeting}
          </h1>
          {mission ? (
            <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-6 text-fg-muted">
              <span className="min-w-0 max-w-full truncate">
                <bdi>{mission.projectName}</bdi>
              </span>
              {mission.dueLabel ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{mission.dueLabel}</span>
                </>
              ) : null}
              {mark ? <span className={cn("rounded-full border px-2 text-xs font-medium", mark)}>{mission.priorityLabel}</span> : null}
            </p>
          ) : null}
          <p className="text-sm leading-6 text-fg-muted">{mission ? `${greeting} · ${date}` : date}</p>
          {mission ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/tasks/${mission.id}`}
                prefetch={false}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
              >
                {t("today.mission.start")}
              </Link>
              {mission.editable ? <MissionDone task={{ id: mission.id, title: mission.title }} /> : null}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-fg-muted">{t("today.mission.empty_body")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
