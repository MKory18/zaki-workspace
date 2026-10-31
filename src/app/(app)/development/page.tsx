import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { fmtNumber } from "@/lib/format";
import { pageActor } from "@/app/(app)/_access";
import { NotFoundError } from "@/server/auth";
import { loadDevelopmentHome } from "@/server/services/team-people";
import { PersonFile, tabOf } from "@/components/team-development/person-file";

/**
 * «الأداء والتطوير» — the people the viewer reads (the owner: everybody; a supervisor: their subtree), sorted by name. A person who
 * reads nobody but themselves sees their own file («ملفي») right here. Reading writes nothing.
 */
const pill = "inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3 hover:bg-surface-2 md:min-h-9";

export default async function DevelopmentPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> } = {}) {
  const { actor } = await pageActor();
  const home = await loadDevelopmentHome(actor).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  // a person who reads nobody but themselves lands on their own file
  if (home.mode === "self") return <PersonFile actor={actor} userId={home.viewerId} tab={tabOf(searchParams?.["tab"])} basePath="/development" />;
  const { t } = getServerT();
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
        </nav>
      </header>

      {home.people.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-fg-muted">{t("teamdev.people.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
          <table className="w-full min-w-[34rem] text-sm" data-people-table>
            <thead>
              <tr className="border-b border-border text-xs text-fg-muted">
                <th className="px-3 py-2 text-start font-medium">{t("teamdev.col.person")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("teamdev.col.supervisor")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("teamdev.col.skills_by")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("teamdev.col.skills_self")}</th>
              </tr>
            </thead>
            <tbody>
              {home.people.map((p) => (
                <tr key={p.userId} className="border-b border-border/60 last:border-0" data-person-row={p.userId}>
                  <td className="px-3 py-2">
                    <Link href={`/development/people/${p.userId}`} className="inline-flex min-h-11 items-center font-medium hover:underline md:min-h-0">
                      {p.name}
                    </Link>
                    {p.jobTitle ? <span className="ms-2 text-xs text-fg-muted">{p.jobTitle}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{p.supervisor ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {fmtNumber(p.ratedBy)} / {fmtNumber(home.skillsTotal)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {fmtNumber(p.ratedSelf)} / {fmtNumber(home.skillsTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export const dynamic = "force-dynamic";
