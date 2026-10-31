import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { pageActor } from "@/app/(app)/_access";
import { NotFoundError } from "@/server/auth";
import { loadSkillMatrix, listSkills } from "@/server/services/team-skills";
import { devAccess } from "@/server/policy/team-development";
import { SkillMatrixTable } from "@/components/team-development/skill-matrix";
import { SkillCatalogue } from "@/components/team-development/skill-catalogue";

/**
 * «مصفوفة المهارات» — people × skills for the owner (everybody) and each supervisor (their subtree), and the checklist itself for
 * whoever keeps it (the owner, `people.manage_lines`). Everybody else gets «not found».
 */
const pill = "inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3 hover:bg-surface-2 md:min-h-9";

export default async function SkillsMatrixPage() {
  const { actor } = await pageActor();
  const miss = (err: unknown): never => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  };
  const access = await devAccess(actor).catch(miss);
  const matrix = await loadSkillMatrix(actor).catch((err: unknown) => (access.canManageLines && err instanceof NotFoundError ? null : miss(err)));
  const catalogue = access.canManageLines ? await listSkills(actor, { includeArchived: true }) : null;
  if (!matrix && !catalogue) notFound();
  const { t } = getServerT();
  return (
    <div dir="rtl" className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("teamdev.skills.page")}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t("teamdev.skills.page_hint")}</p>
        </div>
        <span className="flex flex-wrap gap-2 text-sm">
          {matrix ? (
            <a href="/api/team-development/skills/matrix/csv" className={pill} data-csv>
              {t("teamdev.csv")}
            </a>
          ) : null}
          <Link href="/development" className={pill}>
            {t("teamdev.back")}
          </Link>
        </span>
      </header>
      {matrix ? <SkillMatrixTable matrix={matrix} t={t} /> : null}
      {catalogue ? <SkillCatalogue skills={catalogue} /> : null}
    </div>
  );
}

export const dynamic = "force-dynamic";
