import Link from "next/link";
import type { ServerT } from "@/lib/i18n/server";
import { fmtNumber } from "@/lib/format";
import type { SkillMatrix } from "@/server/services/team-skills";

/**
 * «مصفوفة المهارات» — people (rows, by name) × skills (columns). A cell shows the supervisor's level, and the person's own estimate
 * under it in a smaller type, so the two are never mixed up; a missing value is «—». A legend says which is which.
 */
export function SkillMatrixTable({ matrix, t }: { matrix: SkillMatrix; t: ServerT }) {
  if (matrix.skills.length === 0) return <p className="rounded-xl border border-border bg-surface p-4 text-sm text-fg-muted">{t("teamdev.skill.empty")}</p>;
  if (matrix.people.length === 0) return <p className="rounded-xl border border-border bg-surface p-4 text-sm text-fg-muted">{t("teamdev.people.empty")}</p>;
  return (
    <section className="space-y-2" data-skill-matrix>
      <p className="text-xs leading-5 text-fg-muted" data-matrix-legend>
        {t("teamdev.matrix.legend")}
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-fg-muted">
              <th className="sticky start-0 bg-surface px-3 py-2 text-start font-medium">{t("teamdev.col.person")}</th>
              {matrix.skills.map((s) => (
                <th key={s.id} className="min-w-20 px-2 py-2 text-center font-medium" title={s.description || s.name}>
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.people.map((p) => (
              <tr key={p.userId} className="border-b border-border/60 last:border-0" data-matrix-row={p.userId}>
                <th scope="row" className="sticky start-0 bg-surface px-3 py-2 text-start font-medium">
                  <Link href={`/development/people/${p.userId}`} className="hover:underline">
                    {p.name}
                  </Link>
                </th>
                {matrix.skills.map((s) => {
                  const cell = matrix.cells[p.userId]?.[s.id];
                  return (
                    <td key={s.id} className="px-2 py-2 text-center tabular-nums" data-cell={`${p.userId}:${s.id}`}>
                      <span className="font-semibold">{cell?.manual != null ? fmtNumber(cell.manual) : "—"}</span>
                      <span className="block text-xs text-fg-muted">{cell?.self != null ? fmtNumber(cell.self) : "—"}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
