import { AR } from "@/lib/i18n/dict";
import { formatDecimal, formatHM, toCsv } from "@/lib/time-tracking";

/** The row a report CSV needs (a structural subset of the service's `ReportRow`, so this file stays free of server imports). */
export interface CsvRow {
  day: string;
  userName: string;
  projectName: string | null;
  taskKey: string | null;
  taskTitle: string;
  seconds: number;
  note: string;
  source: string;
  autoStopped: boolean;
}

const word = (key: string): string => AR[key] ?? key;

/**
 * The report as a CSV file for Excel: UTF-8 with a byte order mark, Arabic headings, the hours as `hh:mm` AND as a
 * two-digit decimal (both from the integer seconds), and the total as the last row (an integer sum of the rows above).
 * ⚠️ Task titles and notes are typed by people: a cell that starts with = + - @ is made safe (`csvCell`).
 */
export function reportCsv(rows: readonly CsvRow[], totalSeconds: number): string {
  const head = ["tt.csv.day", "tt.csv.person", "tt.csv.project", "tt.csv.task", "tt.csv.hm", "tt.csv.decimal", "tt.csv.note", "tt.csv.source", "tt.csv.auto"].map(word);
  const body = rows.map((r) => [
    r.day,
    r.userName,
    r.projectName ?? word("tt.report.no_project"),
    r.taskKey ? `${r.taskKey} ${r.taskTitle}` : r.taskTitle,
    formatHM(r.seconds),
    formatDecimal(r.seconds),
    r.note,
    word(`enum.TimeEntrySource.${r.source}`),
    r.autoStopped ? word("tt.csv.yes") : "",
  ]);
  const total = [word("tt.csv.total"), "", "", "", formatHM(totalSeconds), formatDecimal(totalSeconds), "", "", ""];
  return toCsv([head, ...body, total]);
}
