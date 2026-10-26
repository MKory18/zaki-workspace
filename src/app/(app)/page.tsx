import { pageActor } from "@/app/(app)/_access";
import { FirstStepsCard } from "@/components/guide/first-steps-card";
import { GuideCard } from "@/components/guide/guide-card";
import { InstallHint } from "@/components/pwa/install-hint";
import { ActiveProjects } from "@/components/today/active-projects";
import { TeamPulse } from "@/components/today/team-pulse";
import { TodayHero } from "@/components/today/today-hero";
import { TodayTasksCard } from "@/components/today/today-tasks";
import { getServerT } from "@/lib/i18n/server";
import { getToday } from "@/server/services/today";
import { missionOf } from "@/lib/today";

/** The browser tab says «اليوم» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("today.title") };

/**
 * «اليوم» — the calm home of the system. It answers one question: what do I do today, and where do I stand?
 * (The old home was eighteen cards that were links to the rest; the shell now carries the five places.)
 *
 * The page decides nothing. WHO the person is comes from `pageActor()` (which also sends somebody who has not
 * finished onboarding, or whose account is no longer active, away before anything is read); WHAT they see comes
 * from one service call, `getToday(actor)`, which scopes everything to the spaces they can open and to their own
 * work. The parts are in src/components/today; the first-steps card and the install hint are the guide's and
 * the app shell's and draw nothing when they have nothing to say.
 *
 * «نجمة وطريق»: the mission card first («المهمّة الجاية», the page's one heading), the first steps as a road,
 * then the day's tasks with the inline quick add at their foot; beside them the guide's welcome («يلا»), the
 * pulse and the projects.
 *
 * Mobile first: one column with 16px gutters; from `lg` the side column sits beside the tasks.
 */
export default async function TodayPage() {
  const { t } = getServerT();
  const { actor } = await pageActor();
  const data = await getToday(actor);

  const name = data.greeting.firstName;
  const greeting = data.greeting.period === "morning" ? t("today.greeting.morning", { name }) : t("today.greeting.evening", { name });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <TodayHero greeting={greeting} date={data.dateLabel} mission={missionOf(data.tasks)} />
          <FirstStepsCard actor={actor} />
          <TodayTasksCard tasks={data.tasks} hasSpaces={data.hasSpaces} canCreateSpaces={data.canCreateSpaces} quickAdd={data.quickAdd} timeZone={data.timeZone} />
          <InstallHint />
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:w-80 lg:shrink-0">
          <GuideCard />
          {data.pulse ? <TeamPulse pulse={data.pulse} /> : null}
          <ActiveProjects projects={data.projects} isExternal={data.isExternal} />
        </div>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
