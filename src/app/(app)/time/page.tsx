import Link from "next/link";
import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { GuestNotice } from "@/app/(app)/_guest";
import { TimeReportView } from "@/components/time/time-report";
import { getServerT } from "@/lib/i18n/server";
import { tt } from "@/lib/time-client";
import { presetRange } from "@/lib/time-tracking";
import { NotFoundError, ValidationError } from "@/server/auth";
import { currentSpace } from "@/server/services/current-space";
import { actorFeatureOn } from "@/server/services/features";
import { orgTimeZone } from "@/server/services/org-day";
import { timeReport, type ReportQuery } from "@/server/services/time-tracking";

/** The browser tab says «تقرير الوقت» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("tt.report.title") };

/**
 * «تقرير الوقت» — the time people logged, by person, project and day, with a CSV for Excel.
 *
 * The page decides nothing: who the person is comes from `pageActor()`, an external partner gets the notice, the
 * company's `timeTracking` switch makes the page «not found», and WHAT is read (a member: only themselves; the
 * OWNER/ADMIN of a space: anybody of their spaces) is decided by `timeReport`. The filters are the address (a plain GET
 * form), so a report can be linked and the page needs no script.
 *
 * It belongs to «الشغل» without being one of its tabs (`PLACES.work.owns`): it is linked from the task page and from
 * «وقتي اليوم», so the menu and its order are not touched.
 */
type Search = { from?: string; to?: string; userId?: string; projectId?: string; taskId?: string; workspaceId?: string };

export default async function TimeReportPage({ searchParams }: { searchParams: Search }) {
  const { actor } = await pageActor();
  if (actor.isExternal) return <GuestNotice />;
  if (!(await actorFeatureOn(actor, "timeTracking"))) notFound();

  const tz = await orgTimeZone(actor.orgId);
  const now = new Date();
  const presets = { week: presetRange("week", now, tz), month: presetRange("month", now, tz) };
  // the space the person is in, unless they asked for every space of theirs («all»)
  const space = await currentSpace(actor);
  const spaceValue = searchParams.workspaceId || space?.id || "all";
  const query: ReportQuery = {
    from: searchParams.from || presets.week.from,
    to: searchParams.to || presets.week.to,
    userId: searchParams.userId || null,
    projectId: searchParams.projectId || null,
    taskId: searchParams.taskId || null,
    workspaceId: spaceValue === "all" ? null : spaceValue,
  };

  try {
    const report = await timeReport(query, now);
    const csv = new URLSearchParams({ from: report.from, to: report.to, format: "csv" });
    if (query.userId) csv.set("userId", query.userId);
    if (query.projectId) csv.set("projectId", query.projectId);
    if (query.taskId) csv.set("taskId", query.taskId);
    if (query.workspaceId) csv.set("workspaceId", query.workspaceId);
    return <TimeReportView report={report} csvHref={`/api/time/report?${csv.toString()}`} presets={presets} spaceValue={spaceValue} />;
  } catch (err) {
    // a wrong range, a filter the person may not use, a report too big: said in words, with the way back
    const key = err instanceof ValidationError ? err.issues[0]?.message : err instanceof NotFoundError ? err.message : null;
    if (!key) throw err;
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-10 text-center">
        <p role="alert" className="text-sm text-danger">
          {tt(key)}
        </p>
        <Link href="/time" className="text-sm text-accent underline-offset-2 hover:underline">
          {tt("tt.report.title")}
        </Link>
      </div>
    );
  }
}

export const dynamic = "force-dynamic";
