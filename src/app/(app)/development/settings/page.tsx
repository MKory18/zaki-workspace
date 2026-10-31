import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { pageActor } from "@/app/(app)/_access";
import { NotFoundError } from "@/server/auth";
import { devAccess } from "@/server/policy/team-development";
import { listCriteria } from "@/server/services/team-criteria";
import { getWeights } from "@/server/services/team-score";
import { SettingsPanel } from "@/components/team-development/settings-panel";
import { ScoreFormula } from "@/components/team-development/score-panel";

/**
 * «إعدادات التقييم» — the OWNER's (and his partners'): the weights of the score and the criteria a reviewer rates. Everybody else, a
 * guest and the company with the feature switched off get «not found».
 */
export default async function DevelopmentSettingsPage() {
  const { actor } = await pageActor();
  const miss = (err: unknown): never => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  };
  const access = await devAccess(actor).catch(miss);
  if (!access.isOwner) notFound();
  const [weights, criteria] = await Promise.all([getWeights(actor), listCriteria(actor, { all: true })]);
  const { t } = getServerT();
  return (
    <div dir="rtl" className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("teamdev.settings.title")}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t("teamdev.settings.subtitle")}</p>
        </div>
        <Link href="/development" className="inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2 md:min-h-9">
          {t("teamdev.back")}
        </Link>
      </header>
      <SettingsPanel weights={weights} criteria={criteria} />
      <ScoreFormula t={t} weights={weights} />
    </div>
  );
}

export const dynamic = "force-dynamic";
