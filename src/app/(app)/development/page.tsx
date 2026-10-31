import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { pickerPeriods } from "@/lib/team-score";
import { dayKeyOf } from "@/lib/owner-board";
import { pageActor } from "@/app/(app)/_access";
import { NotFoundError } from "@/server/auth";
import { orgTimeZone } from "@/server/services/org-day";
import { loadDevelopmentHome } from "@/server/services/team-people";
import { getWeights, loadScoreTable } from "@/server/services/team-score";
import { PersonFile, tabOf } from "@/components/team-development/person-file";
import { PeriodPicker, ScoreFormula, ScoreTableView } from "@/components/team-development/score-panel";

/**
 * «الأداء والتطوير» — the people the viewer reads (the owner: everybody; a supervisor: their subtree) with the score band and the light
 * of a period, sorted by NAME (by score only when the viewer clicks the column). A person who reads nobody but themselves sees their
 * own file («ملفي») right here. Reading writes nothing.
 */
const pill = "inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3 hover:bg-surface-2 md:min-h-9";
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function DevelopmentPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();
  const miss = (err: unknown): never => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  };
  const home = await loadDevelopmentHome(actor).catch(miss);
  // a person who reads nobody but themselves lands on their own file
  if (home.mode === "self") return <PersonFile actor={actor} userId={home.viewerId} tab={tabOf(searchParams?.["tab"])} basePath="/development" query={searchParams} />;

  const { t } = getServerT();
  const sort = first(searchParams?.["sort"]) === "score" ? "score" : "name";
  const table = await loadScoreTable(actor, { period: first(searchParams?.["period"]), sort }).catch(miss);
  const weights = await getWeights(actor);
  const options = pickerPeriods(dayKeyOf(new Date(), await orgTimeZone(actor.orgId)));
  const href = (extra: Record<string, string>) => `/development?${new URLSearchParams({ period: table.period.key, ...extra }).toString()}`;
  return (
    <div dir="rtl" className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("teamdev.title")}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t(home.mode === "owner" ? "teamdev.subtitle_owner" : "teamdev.subtitle_supervisor")}</p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm" aria-label={t("teamdev.title")}>
          <Link href={`/development/people/${home.viewerId}`} className={pill}>
            {t("nav.tab.myFile")}
          </Link>
          <Link href="/development/skills" className={pill}>
            {t("teamdev.skills.page")}
          </Link>
          <Link href="/structure" className={pill}>
            {t("teamdev.structure.title")}
          </Link>
          {home.mode === "owner" ? (
            <Link href="/development/settings" className={pill} data-settings-link>
              {t("teamdev.settings.title")}
            </Link>
          ) : null}
        </nav>
      </header>

      <PeriodPicker t={t} action="/development" options={options} selected={table.period.key} extra={sort === "score" ? { sort } : {}} />
      {table.period.partial ? <p className="text-xs text-warn">⚠️ {t("teamdev.score.partial")}</p> : null}

      {table.rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-fg-muted">{t("teamdev.people.empty")}</p>
      ) : (
        <ScoreTableView
          table={table}
          t={t}
          kind={table.period.kind}
          sortHref={(s) => href(s === "score" ? { sort: "score" } : {})}
          csvHref={`/api/team-development/people/csv?${new URLSearchParams({ period: table.period.key, sort }).toString()}`}
          personHref={(id) => `/development/people/${id}?tab=score&period=${table.period.key}`}
        />
      )}
      <ScoreFormula t={t} weights={weights} />
    </div>
  );
}

export const dynamic = "force-dynamic";
