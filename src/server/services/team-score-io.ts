import type { ServerT } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/enums";
import { buildCsv } from "@/lib/owner-board";
import type { PeriodKind } from "@/lib/team-score";
import type { ScoreTable } from "@/server/services/team-score";

/** `?kind=` as a period kind (anything else: the month). */
export const periodKind = (value: string | null | undefined): PeriodKind | undefined => (value === "quarter" ? "quarter" : value === "month" ? "month" : undefined);

/**
 * The score table as a CSV: exactly the columns on the screen (the person, the period, the score, its band, the reviewers' light, the
 * light the system suggests, how many reviews counted), in the order of the screen. UTF-8 with a BOM, a cell that starts with = + - @
 * made safe from spreadsheet formulas. Never a private note, never a text of a review.
 */
export function scoreTableCsv(table: ScoreTable, t: ServerT): string {
  const head = [t("teamdev.col.person"), t("teamdev.col.period"), t("teamdev.col.score"), t("teamdev.col.band"), t("teamdev.col.light"), t("teamdev.col.suggested"), t("teamdev.col.reviews")];
  const rows = table.rows.map((r) => [
    r.name,
    table.period.key,
    r.score ?? "—",
    r.band ? t(`teamdev.band.${r.band}`) : "—",
    r.light ? enumLabel("ReviewLight", r.light) : "—",
    r.suggestedLight ? enumLabel("ReviewLight", r.suggestedLight) : "—",
    r.reviews,
  ]);
  return buildCsv([head, ...rows]);
}
