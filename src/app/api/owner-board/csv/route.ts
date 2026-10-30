import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { getServerT } from "@/lib/i18n/server";
import { requireActor } from "@/server/policy/actor";
import { boardAccess } from "@/server/policy/board";
import { loadOverview } from "@/server/services/owner-board";
import { parseBoardQuery, peopleCsv } from "@/server/services/owner-board-io";

/**
 * «لوحة المالك» — the people table as a CSV file: exactly the columns on the screen (no more personal data than the page),
 * UTF-8 with a BOM, cells that start with = + - @ made safe from spreadsheet formulas. The same gate as the table: the owner,
 * or a `board.team` holder for the people in reach; everybody else 404.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const access = await boardAccess(await requireActor());
    const overview = await loadOverview(access, parseBoardQuery(new URL(req.url).searchParams));
    const body = peopleCsv(overview, getServerT().t);
    return new NextResponse(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="owner-board-${overview.window.from}_${overview.window.to}.csv"`,
        "cache-control": "no-store",
      },
    });
  });
}
