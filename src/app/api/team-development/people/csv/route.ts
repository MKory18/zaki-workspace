import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { getServerT } from "@/lib/i18n/server";
import { requireActor } from "@/server/policy/actor";
import { loadScoreTable } from "@/server/services/team-score";
import { periodKind, scoreTableCsv } from "@/server/services/team-score-io";

/** The score table as a CSV: exactly the table the viewer reads (same people, same columns), UTF-8 with a BOM, formula-safe cells. */
export async function GET(req: Request) {
  return withApi(async () => {
    const q = new URL(req.url).searchParams;
    const table = await loadScoreTable(await requireActor(), { period: q.get("period") ?? undefined, kind: periodKind(q.get("kind")), sort: q.get("sort") ?? undefined });
    return new NextResponse(scoreTableCsv(table, getServerT().t), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="performance-${table.period.key}.csv"`, "cache-control": "no-store" },
    });
  });
}
