import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { loadPersonHeader } from "@/server/services/team-people";
import { loadPersonSkills, loadSkillHistory } from "@/server/services/team-skills";
import { PersonSkills } from "./person-skills";

/**
 * «ملف الأداء والتطوير» of one person — the body shared by /development/people/[id] and by /development for a person who reads
 * nobody but themselves. The tabs are plain links (`?tab=`): one request per page. A person the viewer may not open, a guest and
 * the company with the feature switched off get «not found» (never «forbidden»). Reading writes nothing.
 */
export const PERSON_TABS = ["skills"] as const;
export type PersonTab = (typeof PERSON_TABS)[number];

export function tabOf(asked: string | string[] | undefined): PersonTab {
  const one = Array.isArray(asked) ? asked[0] : asked;
  return (PERSON_TABS as readonly string[]).includes(one ?? "") ? (one as PersonTab) : "skills";
}

export async function PersonFile({ actor, userId, tab, basePath }: { actor: Actor; userId: string; tab: PersonTab; basePath: string }) {
  const miss = (err: unknown): never => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  };
  const person = await loadPersonHeader(actor, userId).catch(miss);
  const { t } = getServerT();
  const [rows, history] = await Promise.all([loadPersonSkills(actor, userId).catch(miss), loadSkillHistory(actor, userId).catch(miss)]);

  return (
    <div dir="rtl" className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{person.isSelf ? t("nav.tab.myFile") : person.name}</h1>
          {person.isSelf ? null : (
            <Link href="/development" className="text-sm text-info underline">
              {t("teamdev.back")}
            </Link>
          )}
        </div>
        <p className="text-sm text-fg-muted">
          {person.isSelf ? `${person.name} · ` : ""}
          {person.jobTitle ? `${person.jobTitle} · ` : ""}
          {person.supervisor ? `${t("teamdev.col.supervisor")}: ${person.supervisor.name}` : t("teamdev.structure.no_supervisor")}
        </p>
        {person.inactive ? <p className="text-xs text-warn">⚠️ {t("teamdev.person.inactive")}</p> : null}
      </header>

      <nav className="flex gap-2 overflow-x-auto" aria-label={t("teamdev.title")}>
        {PERSON_TABS.map((key) => (
          <Link
            key={key}
            href={`${basePath}?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-lg border px-3 text-sm md:min-h-9 ${tab === key ? "border-accent bg-accent/10 text-fg" : "border-border bg-surface text-fg-muted hover:bg-surface-2"}`}
          >
            {t(`teamdev.tab.${key}`)}
          </Link>
        ))}
      </nav>

      {tab === "skills" ? <PersonSkills userId={userId} rows={rows} history={history} canEnterManual={person.canEnter} isSelf={person.isSelf} /> : null}
    </div>
  );
}
