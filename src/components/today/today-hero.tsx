import type { TodayTask } from "@/lib/today";
import { getServerT } from "@/lib/i18n/server";
import { ArtSlot } from "@/components/theme/art-slot";
import { ThemeDecor } from "@/components/theme/theme-decor";
import { MissionDone } from "./mission-done";

/**
 * «المهمّة الجاية» — the top of «اليوم» in the owner's adopted mockup: the photograph of Amman at
 * dusk, the veil over it, the gold arch, and the nearest task as the one thing to do now.
 *
 *  - The ribbon says «المهمّة الجاية»; the title is the task's own title in Lalezar with the gold
 *    stroke (`.zk-gta`). Beside it its project, its day and — only when it asks for attention — the
 *    priority tag.
 *  - Two actions: «ابدأ المهمّة» (opens the task) and «خلّصتها» (the person may finish it). Both are
 *    the app's own screens and endpoint; nothing new was built for them.
 *  - The greeting and the date are the small line above the ribbon, so the person is still greeted
 *    by name on the day the page opens.
 *  - With no task due, the card says so and points at the field below it. The photograph, the veil
 *    and the arch are `aria-hidden` and catch no click; every word over them is `on-photo`, the
 *    token that exists so a dark theme can restyle text over a picture.
 */
export function TodayHero({
  greeting,
  date,
  mission,
}: {
  greeting: string;
  date: string;
  /** The nearest open task: overdue first, then today's. */
  mission: TodayTask | null;
}) {
  const { t } = getServerT();
  const priorityTag =
    mission?.priority === "URGENT"
      ? t("today.mission.priority_urgent")
      : mission?.priority === "HIGH"
        ? t("today.mission.priority_high")
        : null;

  return (
    <section
      aria-labelledby="today-mission-title"
      className="zk-hero relative isolate flex min-h-[272px] items-end overflow-hidden rounded-[20px] max-md:min-h-[250px]"
    >
      <div aria-hidden="true" className="zk-hero-art absolute inset-0" />
      <ThemeDecor kind="strip" />
      <ArtSlot slot="today-strip" className="zk-strip-art" />
      <div aria-hidden="true" className="zk-hero-shade absolute inset-0" />
      <div aria-hidden="true" className="zk-hero-dots absolute inset-0" />
      <div aria-hidden="true" className="zk-sunline absolute start-0 end-0 top-0 h-1" />
      <svg
        aria-hidden="true"
        viewBox="0 0 200 300"
        className="zk-hero-arch pointer-events-none absolute bottom-0 start-[5%] h-[92%] w-auto max-md:opacity-45"
      >
        <g fill="none" stroke="currentColor">
          <path d="M8 300V150C8 80 58 38 100 8C142 38 192 80 192 150V300" strokeWidth="2.6" />
          <path d="M22 300V154C22 92 64 56 100 28C136 56 178 92 178 154V300" strokeWidth="1.1" opacity=".55" />
        </g>
        <polygon
          fill="currentColor"
          transform="translate(92.3 -0.6) scale(.64)"
          points="12,2 14.45,6.09 19.07,4.93 17.91,9.55 22,12 17.91,14.45 19.07,19.07 14.45,17.91 12,22 9.55,17.91 4.93,19.07 6.09,14.45 2,12 6.09,9.55 4.93,4.93 9.55,6.09"
        />
      </svg>

      <div className="relative flex max-w-[40rem] flex-col items-start gap-2.5 p-5 pb-11 md:p-7 md:pb-11">
        <p className="text-sm text-on-photo/85">
          {greeting} · {date}
        </p>
        <span className="zk-ribbon">
          <span>{mission ? t("today.mission.ribbon") : t("today.mission.none_ribbon")}</span>
        </span>
        <h1 id="today-mission-title" className="zk-gta zk-hero-title break-words text-[clamp(34px,4.4vw,58px)] leading-[1.2]">
          <bdi>{mission ? mission.title : t("today.mission.empty_title")}</bdi>
        </h1>
        {mission ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-on-photo/85">
            <span className="min-w-0 max-w-full truncate">
              <bdi>{mission.projectName}</bdi>
            </span>
            {mission.dueLabel !== "" ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{mission.dueLabel}</span>
              </>
            ) : null}
            {priorityTag ? (
              <span className="rounded-md bg-danger px-2 text-[13px] font-bold text-danger-fg">{priorityTag}</span>
            ) : null}
          </p>
        ) : (
          <p className="max-w-[52ch] text-[15px] text-on-photo/85">{t("today.mission.empty_body")}</p>
        )}

        {mission ? (
          <div className="mt-1.5 flex flex-wrap gap-2.5">
            <a
              href={`/tasks/${mission.id}`}
              className="inline-flex min-h-[46px] items-center justify-center rounded-xl bg-accent px-[22px] text-base font-bold text-accent-fg transition-colors hover:brightness-110"
            >
              {t("today.mission.start")}
            </a>
            {mission.editable ? <MissionDone taskId={mission.id} title={mission.title} /> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
