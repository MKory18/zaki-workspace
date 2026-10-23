import { pageActor } from "@/app/(app)/_access";
import { GuideCard } from "@/components/guide/guide-card";
import { FirstStepsCard } from "@/components/guide/first-steps-card";
import { InstallHint } from "@/components/pwa/install-hint";
import { ActiveProjects } from "@/components/today/active-projects";
import { TeamPulse } from "@/components/today/team-pulse";
import { TodayHero } from "@/components/today/today-hero";
import { TodayTasksCard } from "@/components/today/today-tasks";
import { getServerT } from "@/lib/i18n/server";
import { getToday } from "@/server/services/today";

/** The browser tab says «اليوم» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("today.title") };

/** «اليوم» — the adopted «نجمة وطريق» home: mission, tasks, route, guide and credits. */
export default async function TodayPage() {
  const { t } = getServerT();
  const { actor } = await pageActor();
  const data = await getToday(actor);
  const name = data.greeting.firstName;
  const greeting = data.greeting.period === "morning" ? t("today.greeting.morning", { name }) : t("today.greeting.evening", { name });
  const mission = data.tasks.overdue[0] ?? data.tasks.today[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-8 pt-2 md:px-[22px] md:pb-[26px] md:pt-[18px]">
      <TodayHero greeting={greeting} date={data.dateLabel} mission={mission} />
      <div className="mt-[18px] grid items-start gap-[18px] lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <TodayTasksCard
          tasks={data.tasks}
          hasSpaces={data.hasSpaces}
          canCreateSpaces={data.canCreateSpaces}
          quickAdd={data.quickAdd}
          timeZone={data.timeZone}
        />
        <div className="flex min-w-0 flex-col gap-[18px]">
          <FirstStepsCard actor={actor} />
          <GuideCard userId={actor.userId} />
          {data.pulse ? <TeamPulse pulse={data.pulse} /> : null}
          <ActiveProjects projects={data.projects} isExternal={data.isExternal} />
        </div>
      </div>
      <InstallHint />
      <p className="mt-4 text-xs text-muted opacity-85">{t("today.credits")}</p>
    </div>
  );
}

export const dynamic = "force-dynamic";
