import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as reportRoute from "@/app/api/time/report/route";
import { withFeature } from "@/lib/features";
import { sumSeconds } from "@/lib/time-tracking";
import type { TimeReport } from "@/server/services/time-tracking";
import type { Prisma } from "@prisma/client";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «تقرير الوقت» — the report of the time people logged (the owner, 2026-10-30).
 *
 * What this pins, against a real PostgreSQL:
 *  - the total and every group (person, project, day) are INTEGER sums of the entries listed: they add up exactly;
 *  - a member sees only themselves (asking for somebody else is 403); the OWNER/ADMIN of a space pick anybody of THEIR
 *    spaces, and never read another space; a filter on a space, a project or a task the person may not open is «not found»;
 *  - a day is the COMPANY's: the range is inclusive and the first and last instants of a day land on the right side;
 *  - a running timer is not counted until it stops; an automatically stopped entry says so;
 *  - the CSV is UTF-8 with a byte order mark, carries hh:mm and the decimal, and a cell that starts with = + - @ is made safe;
 *  - a guest never reads it, the owner reads it silently, and the company's switch closes it (404).
 */

beforeEach(async () => {
  await db.timeEntry.deleteMany({});
});
afterAll(async () => {
  await db.timeEntry.deleteMany({});
});

async function world() {
  const team = await makeTeam();
  const mate = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "ليلى" });
  // an org ADMIN who is in space ONE only: he manages that space and has no business in the second
  const lead = await makeUser({ orgId: team.org.id, role: "ADMIN", name: "مدير المساحة" });
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: mate.id }, { userId: lead.id }, { userId: team.admin.id, role: "ADMIN" }, { userId: team.guest.id, role: "GUEST" }], "الأولى");
  const ws2 = await makeWorkspace(team.org.id, [{ userId: mate.id }, { userId: team.admin.id, role: "ADMIN" }], "الثانية");
  const p1 = await makeProject(ws.id, "مشروع أ");
  const p1b = await makeProject(ws.id, "مشروع ب");
  const p2 = await makeProject(ws2.id, "مشروع ج");
  const mk = (title: string, workspaceId: string, p: typeof p1) =>
    makeTask({ orgId: team.org.id, workspaceId, projectId: p.project.id, boardId: p.board.id, columnId: p.todo.id, creatorId: team.owner.id, assigneeId: team.member.id, title });
  const taskA = await mk("مهمة أ", ws.id, p1);
  const taskB = await mk("مهمة ب", ws.id, p1b);
  const taskC = await mk("مهمة ج", ws2.id, p2);
  return { ...team, mate, lead, ws, ws2, p1, p1b, p2, taskA, taskB, taskC };
}

type World = Awaited<ReturnType<typeof world>>;

const seed = (w: World, userId: string, taskId: string | null, over: Partial<Prisma.TimeEntryUncheckedCreateInput> & { seconds: number; startedAt: Date }) =>
  db.timeEntry.create({
    data: {
      orgId: w.org.id,
      workspaceId: w.ws.id,
      userId,
      taskId,
      taskTitle: "مهمة",
      stoppedAt: new Date(over.startedAt.getTime() + over.seconds * 1000),
      source: "TIMER",
      ...over,
    },
  });

/** A noon (Damascus: 09:00Z) of a day of March 2031. */
const noon = (day: number) => new Date(`2031-03-${String(day).padStart(2, "0")}T09:00:00.000Z`);

async function report(query: Record<string, string> = {}) {
  const params = new URLSearchParams({ from: "2031-03-01", to: "2031-03-31", ...query });
  const res = await call(reportRoute.GET, { url: `http://localhost/api/time/report?${params.toString()}` });
  return { res, body: res.json as unknown as TimeReport };
}

async function setSwitch(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "timeTracking", on) as Prisma.InputJsonValue } });
}

describe("the report's numbers are exact", () => {
  it("the total and every group are integer sums of the entries: they add up to the second", async () => {
    const w = await world();
    // awkward lengths on purpose: no round hour among them
    const a = await seed(w, w.member.id, w.taskA.id, { startedAt: noon(2), seconds: 1201 });
    const b = await seed(w, w.member.id, w.taskB.id, { startedAt: noon(2), seconds: 1199 });
    const c = await seed(w, w.mate.id, w.taskA.id, { startedAt: noon(3), seconds: 3599 });
    const d = await seed(w, w.mate.id, w.taskB.id, { startedAt: noon(4), seconds: 7 });
    const e = await seed(w, w.mate.id, w.taskC.id, { startedAt: noon(4), seconds: 86400, workspaceId: w.ws2.id });
    await loginAs(w.owner.id);
    const { res, body } = await report();
    expect(res.status).toBe(200);
    expect(body.rows).toHaveLength(5);
    const expected = 1201 + 1199 + 3599 + 7 + 86400;
    expect(body.totalSeconds).toBe(expected);
    expect(sumSeconds(body.rows)).toBe(expected);
    for (const groups of [body.byPerson, body.byProject, body.byDay]) {
      expect(groups.reduce((n, g) => n + g.seconds, 0)).toBe(expected);
    }
    expect(Object.fromEntries(body.byPerson.map((g) => [g.key, g.seconds]))).toEqual({ [w.member.id]: 2400, [w.mate.id]: 3599 + 7 + 86400 });
    expect(Object.fromEntries(body.byProject.map((g) => [g.label, g.seconds]))).toEqual({ "مشروع أ": 1201 + 3599, "مشروع ب": 1199 + 7, "مشروع ج": 86400 });
    expect(Object.fromEntries(body.byDay.map((g) => [g.key, g.seconds]))).toEqual({ "2031-03-02": 2400, "2031-03-03": 3599, "2031-03-04": 7 + 86400 });
    expect(body.byDay.map((g) => g.key)).toEqual(["2031-03-02", "2031-03-03", "2031-03-04"]);
    expect(new Set(body.rows.map((r) => r.id))).toEqual(new Set([a.id, b.id, c.id, d.id, e.id]));
    // each row says its project, its task key and the person
    const row = body.rows.find((r) => r.id === a.id)!;
    expect(row).toMatchObject({ day: "2031-03-02", userName: "Member", projectName: "مشروع أ", taskTitle: "مهمة أ", seconds: 1201, source: "TIMER", autoStopped: false });
    expect(row.taskKey).toMatch(/-\d+$/);
  });

  it("the range is inclusive and a day is the company's: the last and first instants of a day land on the right side", async () => {
    const w = await world();
    // Damascus is UTC+3 all year: 2031-03-09T21:00:00Z is 00:00 on March 10
    const lastOfNinth = await seed(w, w.member.id, w.taskA.id, { startedAt: new Date("2031-03-09T20:59:59.000Z"), seconds: 60 });
    const firstOfTenth = await seed(w, w.member.id, w.taskA.id, { startedAt: new Date("2031-03-09T21:00:00.000Z"), seconds: 120 });
    const lastOfTenth = await seed(w, w.member.id, w.taskA.id, { startedAt: new Date("2031-03-10T20:59:59.000Z"), seconds: 180 });
    const firstOfEleventh = await seed(w, w.member.id, w.taskA.id, { startedAt: new Date("2031-03-10T21:00:00.000Z"), seconds: 240 });
    await loginAs(w.member.id);
    const tenth = (await report({ from: "2031-03-10", to: "2031-03-10" })).body;
    expect(tenth.rows.map((r) => r.id).sort()).toEqual([firstOfTenth.id, lastOfTenth.id].sort());
    expect(tenth.totalSeconds).toBe(300);
    const span = (await report({ from: "2031-03-09", to: "2031-03-11" })).body;
    expect(span.rows).toHaveLength(4);
    expect(span.rows.find((r) => r.id === lastOfNinth.id)!.day).toBe("2031-03-09");
    expect(span.rows.find((r) => r.id === firstOfEleventh.id)!.day).toBe("2031-03-11");
  });

  it("reads days in another zone too (New York)", async () => {
    const w = await world();
    await db.organization.update({ where: { id: w.org.id }, data: { timezone: "America/New_York" } });
    // 2031-03-10T03:30Z is 23:30 EST on March 9
    const late = await seed(w, w.member.id, w.taskA.id, { startedAt: new Date("2031-03-10T03:30:00.000Z"), seconds: 60 });
    await loginAs(w.member.id);
    const ninth = (await report({ from: "2031-03-09", to: "2031-03-09" })).body;
    expect(ninth.rows.map((r) => r.id)).toEqual([late.id]);
    expect((await report({ from: "2031-03-10", to: "2031-03-10" })).body.rows).toEqual([]);
    expect(ninth.timeZone).toBe("America/New_York");
  });

  it("a running timer is not counted until it stops; an automatically stopped entry says so; a deleted task's entry is still listed", async () => {
    const w = await world();
    await seed(w, w.member.id, w.taskA.id, { startedAt: noon(5), stoppedAt: null, seconds: 0 });
    await seed(w, w.mate.id, w.taskA.id, { startedAt: noon(5), seconds: 43200, autoStopped: true });
    const orphan = await seed(w, w.mate.id, w.taskB.id, { startedAt: noon(6), seconds: 600, taskTitle: "مهمة انحذفت" });
    await db.task.delete({ where: { id: w.taskB.id } });
    await loginAs(w.owner.id);
    const { body } = await report();
    expect(body.rows).toHaveLength(2);
    expect(body.totalSeconds).toBe(43200 + 600);
    expect(body.rows.find((r) => r.autoStopped)).toMatchObject({ seconds: 43200 });
    const gone = body.rows.find((r) => r.id === orphan.id)!;
    expect(gone).toMatchObject({ taskId: null, taskKey: null, projectId: null, projectName: null, taskTitle: "مهمة انحذفت" });
    expect(body.byProject.find((g) => g.key === "none")).toMatchObject({ seconds: 600 });
  });
});

describe("who reads what", () => {
  it("a member sees only themselves, and asking for somebody else is 403; naming oneself is fine", async () => {
    const w = await world();
    await seed(w, w.member.id, w.taskA.id, { startedAt: noon(2), seconds: 600 });
    await seed(w, w.mate.id, w.taskA.id, { startedAt: noon(2), seconds: 6000 });
    await loginAs(w.member.id);
    const own = await report();
    expect(own.body.totalSeconds).toBe(600);
    expect(own.body.rows.every((r) => r.userId === w.member.id)).toBe(true);
    expect(own.body.canPickPerson).toBe(false);
    expect(own.body.people).toEqual([{ id: w.member.id, name: "Member" }]);
    const other = await report({ userId: w.mate.id });
    expect(other.res.status).toBe(403);
    expect(other.res.json?.["message"]).toBe("tt.e.report_person_denied");
    expect((await report({ userId: w.member.id })).body.totalSeconds).toBe(600);
  });

  it("the space's ADMIN picks anybody of the space, and sees everybody by default", async () => {
    const w = await world();
    await seed(w, w.member.id, w.taskA.id, { startedAt: noon(2), seconds: 600 });
    await seed(w, w.mate.id, w.taskA.id, { startedAt: noon(2), seconds: 6000 });
    await loginAs(w.lead.id);
    const all = await report();
    expect(all.body.totalSeconds).toBe(6600);
    expect(all.body.canPickPerson).toBe(true);
    expect(all.body.people.map((p) => p.id)).toEqual(expect.arrayContaining([w.member.id, w.mate.id, w.lead.id]));
    const one = await report({ userId: w.mate.id });
    expect(one.body.totalSeconds).toBe(6000);
    expect(one.body.rows.every((r) => r.userId === w.mate.id)).toBe(true);
  });

  it("spaces are separate: the ADMIN of space one never reads space two; a member reads their own entries of any space of theirs", async () => {
    const w = await world();
    await seed(w, w.mate.id, w.taskA.id, { startedAt: noon(2), seconds: 600 });
    const inTwo = await seed(w, w.mate.id, w.taskC.id, { startedAt: noon(2), seconds: 6000, workspaceId: w.ws2.id });
    await loginAs(w.lead.id);
    const lead = await report();
    expect(lead.body.totalSeconds).toBe(600);
    expect(lead.body.rows.map((r) => r.id)).not.toContain(inTwo.id);
    expect(lead.body.spaces.map((s) => s.id)).toEqual([w.ws.id]);
    // naming space two (or a project, or a task of it) is «not found», as its own page would say
    expect((await report({ workspaceId: w.ws2.id })).res.status).toBe(404);
    expect((await report({ projectId: w.p2.project.id })).res.status).toBe(404);
    expect((await report({ taskId: w.taskC.id })).res.status).toBe(404);
    expect(lead.body.projects.map((p) => p.name).sort()).toEqual(["مشروع أ", "مشروع ب"]);

    // the mate is in both spaces: both of their own entries, and one space at a time with the filter
    await loginAs(w.mate.id);
    expect((await report()).body.totalSeconds).toBe(6600);
    expect((await report({ workspaceId: w.ws2.id })).body.rows.map((r) => r.id)).toEqual([inTwo.id]);
    expect((await report({ workspaceId: w.ws.id })).body.totalSeconds).toBe(600);

    // the ADMIN of both reads both, and the owner reads every space
    await loginAs(w.admin.id);
    expect((await report()).body.totalSeconds).toBe(6600);
    await loginAs(w.owner.id);
    expect((await report()).body.totalSeconds).toBe(6600);
  });

  it("filters by project, task and person; a project of the space the person may not open is «not found»", async () => {
    const w = await world();
    await seed(w, w.member.id, w.taskA.id, { startedAt: noon(2), seconds: 100 });
    await seed(w, w.member.id, w.taskB.id, { startedAt: noon(2), seconds: 200 });
    await seed(w, w.mate.id, w.taskB.id, { startedAt: noon(3), seconds: 400 });
    await loginAs(w.lead.id);
    expect((await report({ projectId: w.p1.project.id })).body.totalSeconds).toBe(100);
    expect((await report({ projectId: w.p1b.project.id })).body.totalSeconds).toBe(600);
    expect((await report({ taskId: w.taskB.id })).body.totalSeconds).toBe(600);
    expect((await report({ taskId: w.taskB.id, userId: w.mate.id })).body.totalSeconds).toBe(400);
    expect((await report({ projectId: "nope" })).res.status).toBe(404);
    // the filters a member names stay inside what they are allowed
    await loginAs(w.member.id);
    expect((await report({ taskId: w.taskB.id })).body.totalSeconds).toBe(200);
  });

  it("a guest never reads it, the owner reads it, and a switched-off company gets «not found»", async () => {
    const w = await world();
    await seed(w, w.member.id, w.taskA.id, { startedAt: noon(2), seconds: 100 });
    await loginAs(w.guest.id);
    const guest = await report();
    expect(guest.res.status).toBe(403);
    expect(guest.res.json?.["message"]).toBe("tt.e.guest_denied");
    await loginAs(w.owner.id);
    expect((await report()).res.status).toBe(200);
    // reading as the owner leaves no trace: no membership, no audit row
    expect(await db.workspaceMember.count({ where: { workspaceId: w.ws.id, userId: w.owner.id } })).toBe(0);
    await setSwitch(w.org.id, false);
    const off = await report();
    expect(off.res.status).toBe(404);
    expect(off.res.json?.["message"]).toBe("features.off");
    await setSwitch(w.org.id, true);
    expect((await report()).body.totalSeconds).toBe(100);
  });

  it("another company's entries never show", async () => {
    const a = await world();
    const b = await world();
    await seed(a, a.member.id, a.taskA.id, { startedAt: noon(2), seconds: 100 });
    await seed(b, b.member.id, b.taskA.id, { startedAt: noon(2), seconds: 999 });
    await loginAs(a.owner.id);
    expect((await report()).body.totalSeconds).toBe(100);
    await loginAs(b.owner.id);
    expect((await report()).body.totalSeconds).toBe(999);
  });
});

describe("the range", () => {
  it("defaults to this week, and refuses a wrong or too long range in words", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await call(reportRoute.GET, { url: "http://localhost/api/time/report" });
    expect(res.status).toBe(200);
    const body = res.json as unknown as TimeReport;
    expect(body.from <= body.to).toBe(true);
    const days = (Date.parse(`${body.to}T00:00:00Z`) - Date.parse(`${body.from}T00:00:00Z`)) / 86_400_000;
    expect(days).toBe(6);

    const bad = [
      await report({ from: "2031-03-10", to: "2031-03-01" }),
      await report({ from: "2031-02-30", to: "2031-03-01" }),
      await report({ from: "2031-01-01", to: "2032-01-02" }),
    ];
    for (const r of bad) expect(r.res.status).toBe(422);
    expect(JSON.stringify(bad[0]!.res.json)).toContain("tt.e.bad_range");
    expect(JSON.stringify(bad[2]!.res.json)).toContain("tt.e.range_too_long");
    // a whole year (365 days apart) is fine, 366 apart is the limit
    expect((await report({ from: "2031-01-01", to: "2032-01-01" })).res.status).toBe(200);
  });
});

/** A small CSV reader (quotes, doubled quotes, CRLF), so the test looks at cells and not at raw text. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** The raw bytes of the CSV answer: `Response.text()` drops a leading byte order mark, and the mark is exactly what is under test. */
async function csvBytes(query: string) {
  const res = await reportRoute.GET(new Request(`http://localhost/api/time/report?from=2031-03-01&to=2031-03-31&format=csv${query}`));
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { res, bytes, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) };
}

describe("the CSV", () => {
  it("is UTF-8 with a byte order mark, has hh:mm and the decimal, and a total row of the same integer sum", async () => {
    const w = await world();
    await seed(w, w.member.id, w.taskA.id, { startedAt: noon(2), seconds: 5400, note: "اجتماع" });
    await seed(w, w.member.id, w.taskB.id, { startedAt: noon(3), seconds: 1200 });
    await loginAs(w.member.id);
    const { res, bytes, text } = await csvBytes("");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")?.toLowerCase()).toContain("text/csv");
    expect(res.headers.get("content-type")?.toLowerCase()).toContain("utf-8");
    expect(res.headers.get("content-disposition")).toContain("time-report-2031-03-01_2031-03-31.csv");
    // EF BB BF: what Excel needs to read the Arabic
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const table = parseCsv(text.slice(1));
    expect(table[0]).toEqual(["اليوم", "الشخص", "المشروع", "المهمة", "ساعات:دقائق", "ساعات (عشري)", "ملاحظة", "النوع", "أُوقف تلقائيًا"]);
    expect(table).toHaveLength(4); // heading, two entries, the total
    expect(table[1]!.slice(0, 3)).toEqual(["2031-03-02", "Member", "مشروع أ"]);
    expect(table[1]!.slice(4)).toEqual(["01:30", "1.50", "اجتماع", "مؤقّت", ""]);
    expect(table[2]!.slice(4, 6)).toEqual(["00:20", "0.33"]);
    // the total is one integer sum: 6600 s = 01:50 = 1.83
    expect(table[3]).toEqual(["المجموع", "", "", "", "01:50", "1.83", "", "", ""]);
  });

  it("makes a cell that starts with = + - @ safe, whoever typed it (a note, a person's name, a task)", async () => {
    const w = await world();
    await db.task.update({ where: { id: w.taskA.id }, data: { title: '=HYPERLINK("http://evil","x")' } });
    await seed(w, w.member.id, w.taskA.id, { startedAt: noon(2), seconds: 60, note: "+SUM(A1:A9)" });
    await seed(w, w.member.id, w.taskB.id, { startedAt: noon(3), seconds: 60, note: "-2+3" });
    await seed(w, w.member.id, w.taskB.id, { startedAt: noon(4), seconds: 60, note: "@cmd|' /C calc'!A0" });
    await seed(w, w.member.id, null, { startedAt: noon(5), seconds: 60, taskTitle: "=1+1" });
    await db.user.update({ where: { id: w.member.id }, data: { name: "=cmd|' /C calc'!A0" } });
    await loginAs(w.member.id);
    const { text } = await csvBytes("");
    const table = parseCsv(text.slice(1));
    const flat = table.slice(1, -1).flat();
    // every dangerous cell is preceded by an apostrophe...
    expect(flat).toContain("'+SUM(A1:A9)");
    expect(flat).toContain("'-2+3");
    expect(flat).toContain("'@cmd|' /C calc'!A0");
    expect(flat).toContain("'=cmd|' /C calc'!A0");
    expect(flat).toContain("'=1+1"); // a task that no longer exists: its title is the whole cell
    // ...and no cell of the whole file begins with a formula character
    for (const cell of table.flat()) expect(/^[=+\-@\t\r]/.test(cell), cell).toBe(false);
  });
});
