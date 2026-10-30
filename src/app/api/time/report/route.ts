import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { timeReport } from "@/server/services/time-tracking";
import { reportCsv } from "@/lib/time-report-csv";

/**
 * «تقرير الوقت» — `?from=YYYY-MM-DD&to=YYYY-MM-DD` (the company's days, inclusive; default: this week) with optional
 * `userId`, `projectId`, `taskId`, `workspaceId`; `format=csv` downloads it for Excel.
 *
 * A member sees only themselves; the OWNER/ADMIN of a space may pick anybody of THEIR spaces; another space's entries
 * never show. Totals are integer sums of the entries listed. No money anywhere. Every guard is in the service.
 */
const querySchema = z.object({
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  userId: z.string().max(64).optional(),
  projectId: z.string().max(64).optional(),
  taskId: z.string().max(64).optional(),
  workspaceId: z.string().max(64).optional(),
  format: z.enum(["json", "csv"]).optional(),
});

export async function GET(req: Request) {
  return withApi(async () => {
    const url = new URL(req.url);
    const q = querySchema.parse(Object.fromEntries([...url.searchParams.entries()].filter(([, v]) => v !== "")));
    const report = await timeReport(q);
    if (q.format === "csv") {
      return new NextResponse(reportCsv(report.rows, report.totalSeconds), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="time-report-${report.from}_${report.to}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  });
}
