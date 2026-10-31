import { describe, expect, it } from "vitest";
import * as fieldsRoute from "@/app/api/projects/[id]/fields/route";
import * as fieldRoute from "@/app/api/projects/[id]/fields/[fieldId]/route";
import * as taskFieldsRoute from "@/app/api/tasks/[id]/fields/route";
import * as taskFieldRoute from "@/app/api/tasks/[id]/fields/[fieldId]/route";
import * as moveRoute from "@/app/api/tasks/[id]/move/route";
import * as completeRoute from "@/app/api/tasks/[id]/complete/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import { createTask, setTaskCompletion } from "@/server/services/tasks";
import { fieldCellsFor, sumNumberField } from "@/server/services/custom-fields";
import { queryTasksForView } from "@/server/services/views";
import { withFeature } from "@/lib/features";
import { sumDecimals } from "@/lib/custom-fields";
import type { Prisma } from "@prisma/client";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «حقول مخصصة» — custom fields on the tasks of a project (the owner's backlog, 2026-10-31).
 *
 * What this pins, against a real database:
 *  - the DEFINITIONS belong to the space's ADMIN and the owner (a member is refused), at most 15 live fields, archiving frees a slot
 *    and keeps every value, an option that is taken away keeps its id, a field id of another project or company is «not found»;
 *  - a VALUE is checked per type (bounds, https only, the person must be in the space, the money field's own currency), numbers are
 *    DECIMAL so 0.1 + 0.2 is stored and summed as exactly 0.3, and an emptied box clears the row;
 *  - REQUIRED fields stop a completion with 422 `fields.required` and the labels, through BOTH `moveTask` and `setTaskCompletion`
 *    (the board's drag and the tick box), never a quick-add, never a reopen, never while the switch is off or the field archived;
 *  - a partner is handed NO field (the task's own answer never carries one), money never reaches one, a reward task keeps its
 *    owner-only lock, the owner reading a space he is not in writes no value;
 *  - the list FILTERS by a choice / yes-no / person field and SORTS by a number / date field and still applies every access rule;
 *  - the switch off: every door answers «not found», nothing is enforced, nothing is lost; deleting the project removes the rest.
 */

async function world() {
  const team = await makeTeam();
  const colleague = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Colleague" });
  const ws = await makeWorkspace(
    team.org.id,
    [{ userId: team.member.id }, { userId: colleague.id }, { userId: team.admin.id, role: "ADMIN" }, { userId: team.guest.id, role: "GUEST" }],
    "مساحة",
  );
  const made = await makeProject(ws.id, "مشروع");
  const mk = (title: string, over: { projectId?: string; boardId?: string; columnId?: string } = {}) =>
    makeTask({
      orgId: team.org.id,
      workspaceId: ws.id,
      projectId: over.projectId ?? made.project.id,
      boardId: over.boardId ?? made.board.id,
      columnId: over.columnId ?? made.todo.id,
      creatorId: team.owner.id,
      assigneeId: team.member.id,
      title,
    });
  const task = await mk("المهمة");
  return { ...team, colleague, ws, made, task, mk };
}
type World = Awaited<ReturnType<typeof world>>;

const PID = (w: World) => ({ id: w.made.project.id });
const addField = async (w: World, body: Record<string, unknown>, as = w.admin.id) => {
  await loginAs(as);
  const res = await call(fieldsRoute.POST, { params: PID(w), body });
  return { res, field: (res.json as { field: { id: string; label: string; options: { id: string; label: string; deleted?: boolean }[] } } | null)?.field };
};
const setValue = async (taskId: string, fieldId: string, value: unknown) => call(taskFieldRoute.PUT, { method: "PUT", params: { id: taskId, fieldId }, body: { value } });
const card = async (taskId: string) => (await call(taskFieldsRoute.GET, { params: { id: taskId } })).json as { fields: { id: string; label: string }[]; values: Record<string, unknown>; people: { id: string }[] };
const move = (taskId: string, columnId: string) => call(moveRoute.POST, { params: { id: taskId }, body: { columnId } });
const complete = (taskId: string, done = true) => call(completeRoute.POST, { params: { id: taskId }, body: { complete: done } });
async function switchOff(w: World, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
  await db.organization.update({ where: { id: w.org.id }, data: { settings: withFeature(org.settings, "customFields", on) as Prisma.InputJsonValue } });
}

describe("«حقول مخصصة»: who defines the fields", () => {
  it("the space's ADMIN and the owner define; a member, a colleague and a guest are refused, and nothing is written", async () => {
    const w = await world();
    expect((await addField(w, { label: "الميزانية", type: "NUMBER", unit: "دينار" }, w.admin.id)).res.status).toBe(201);
    // the owner is in no row of the space and still defines (the owner's reach)
    expect((await addField(w, { label: "ملاحظة", type: "TEXT" }, w.owner.id)).res.status).toBe(201);
    for (const person of [w.member, w.colleague, w.guest]) {
      const res = (await addField(w, { label: "ممنوع", type: "TEXT" }, person.id)).res;
      expect(res.status, person.name).toBe(403);
    }
    expect(await db.projectField.count({ where: { projectId: w.made.project.id } })).toBe(2);
    // a member is refused the patch too
    const f = await db.projectField.findFirstOrThrow({ where: { projectId: w.made.project.id } });
    await loginAs(w.member.id);
    expect((await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: f.id }, body: { label: "غيّرت" } })).status).toBe(403);
    expect((await db.projectField.findUniqueOrThrow({ where: { id: f.id } })).label).toBe("الميزانية");
  });

  it("someone outside the space, and someone from another company, get nothing", async () => {
    const w = await world();
    const stranger = await makeUser({ orgId: w.org.id, role: "ADMIN", name: "Stranger" });
    const other = await makeTeam();
    for (const person of [stranger, other.owner, other.admin]) {
      const res = (await addField(w, { label: "x", type: "TEXT" }, person.id)).res;
      expect([403, 404], person.name).toContain(res.status);
    }
    expect(await db.projectField.count({ where: { projectId: w.made.project.id } })).toBe(0);
  });

  it("a field has a label of 1 to 60 characters and one of the ten types; the type never changes", async () => {
    const w = await world();
    expect((await addField(w, { label: "  ", type: "TEXT" })).res.status).toBe(422);
    expect((await addField(w, { label: "ا".repeat(61), type: "TEXT" })).res.status).toBe(422);
    expect((await addField(w, { label: "x", type: "RATING" })).res.status).toBe(422);
    expect((await addField(w, { label: "x", type: "MONEY" })).res.status).toBe(422); // no currency
    expect((await addField(w, { label: "x", type: "MONEY", currency: "XXX" })).res.status).toBe(422);
    expect((await addField(w, { label: "x", type: "SINGLE_CHOICE" })).res.status).toBe(422); // no options
    const made = (await addField(w, { label: "رقم", type: "NUMBER" })).field!;
    // the patch has no `type` key: a type sent is ignored
    await loginAs(w.admin.id);
    await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: made.id }, body: { type: "TEXT", label: "رقم 2" } });
    const row = await db.projectField.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.type).toBe("NUMBER");
    expect(row.label).toBe("رقم 2");
    expect(row.orgId).toBe(w.org.id);
  });

  it("at most 15 live fields: the 16th is refused, archiving one frees the slot and un-archiving past 15 is refused", async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < 15; i++) ids.push((await addField(w, { label: `حقل ${i}`, type: "TEXT" })).field!.id);
    expect((await addField(w, { label: "السادس عشر", type: "TEXT" })).res.status).toBe(403);
    await loginAs(w.admin.id);
    expect((await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: ids[0]! }, body: { archived: true } })).status).toBe(200);
    const sixteenth = (await addField(w, { label: "السادس عشر", type: "TEXT" })).field!;
    expect(sixteenth.id).toBeTruthy();
    await loginAs(w.admin.id);
    const back = await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: ids[0]! }, body: { archived: false } });
    expect(back.status).toBe(403);
    expect((await db.projectField.findUniqueOrThrow({ where: { id: ids[0]! } })).archived).toBe(true);
  });

  it("two adds at once cannot pass 15", async () => {
    const w = await world();
    for (let i = 0; i < 14; i++) await addField(w, { label: `حقل ${i}`, type: "TEXT" });
    await loginAs(w.admin.id);
    const results = await Promise.all([1, 2, 3].map((i) => call(fieldsRoute.POST, { params: PID(w), body: { label: `سباق ${i}`, type: "TEXT" } })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await db.projectField.count({ where: { projectId: w.made.project.id, archived: false } })).toBe(15);
  });

  it("reorders by a fractional position, one row written, in the order sent", async () => {
    const w = await world();
    const a = (await addField(w, { label: "أ", type: "TEXT" })).field!;
    const b = (await addField(w, { label: "ب", type: "TEXT" })).field!;
    const c = (await addField(w, { label: "ج", type: "TEXT" })).field!;
    const before = new Map((await db.projectField.findMany({ where: { projectId: w.made.project.id } })).map((r) => [r.id, r.position.toString()]));
    await loginAs(w.admin.id);
    expect((await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: c.id }, body: { afterId: null } })).status).toBe(200);
    await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: a.id }, body: { afterId: b.id } });
    const list = (await call(fieldsRoute.GET, { params: PID(w) })).json as { fields: { label: string }[] };
    expect(list.fields.map((f) => f.label)).toEqual(["ج", "ب", "أ"]);
    const after = new Map((await db.projectField.findMany({ where: { projectId: w.made.project.id } })).map((r) => [r.id, r.position.toString()]));
    expect(after.get(b.id)).toBe(before.get(b.id)); // the untouched one kept its row as it was
    // a field of another project is not found
    const o = await makeProject(w.ws.id, "مشروع آخر");
    expect((await call(fieldRoute.PATCH, { method: "PATCH", params: { id: o.project.id, fieldId: a.id }, body: { afterId: null } })).status).toBe(404);
  });

  it("an option taken away keeps its id and reads deleted; the values that hold it keep it", async () => {
    const w = await world();
    const f = (await addField(w, { label: "الأولوية", type: "SINGLE_CHOICE", options: [{ label: "عالي", color: "danger" }, { label: "منخفض", color: "ok" }] })).field!;
    const [high, low] = f.options;
    await loginAs(w.member.id);
    expect((await setValue(w.task.id, f.id, high!.id)).status).toBe(200);
    // the admin drops «عالي» and renames «منخفض»
    await loginAs(w.admin.id);
    const patched = await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: f.id }, body: { options: [{ id: low!.id, label: "هادئ", color: "ok" }, { label: "جديد", color: "info" }] } });
    expect(patched.status).toBe(200);
    const options = (patched.json as { field: { options: { id: string; label: string; deleted?: boolean }[] } }).field.options;
    expect(options.find((o) => o.id === high!.id)).toMatchObject({ label: "عالي", deleted: true });
    expect(options.find((o) => o.id === low!.id)).toMatchObject({ label: "هادئ" });
    expect(options.length).toBe(3);
    // the value still holds the id; it can no longer be picked fresh
    const row = await db.taskFieldValue.findFirstOrThrow({ where: { taskId: w.task.id, fieldId: f.id } });
    expect(row.valueText).toBe(high!.id);
    await loginAs(w.colleague.id);
    expect((await setValue(w.task.id, f.id, high!.id)).status).toBe(422);
    expect((await setValue(w.task.id, f.id, low!.id)).status).toBe(200);
    // an option id is not trusted from outside: a stranger's id becomes a NEW option
    await loginAs(w.admin.id);
    const again = await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: f.id }, body: { options: [{ id: "forged", label: "مزوّر" }] } });
    const ids = (again.json as { field: { options: { id: string }[] } }).field.options.map((o) => o.id);
    expect(ids).not.toContain("forged");
    // 30 live options at most
    const many = await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: f.id }, body: { options: Array.from({ length: 31 }, (_, i) => ({ label: `خ${i}` })) } });
    expect(many.status).toBe(422);
  });

  it("the currency of a money field is locked once an amount is stored", async () => {
    const w = await world();
    const f = (await addField(w, { label: "التكلفة", type: "MONEY", currency: "JOD" })).field!;
    await loginAs(w.admin.id);
    expect((await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: f.id }, body: { currency: "USD" } })).status).toBe(200);
    await loginAs(w.member.id);
    expect((await setValue(w.task.id, f.id, 1500)).status).toBe(200);
    await loginAs(w.admin.id);
    expect((await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: f.id }, body: { currency: "EUR" } })).status).toBe(403);
  });
});

describe("«حقول مخصصة»: a value, per type, against the database", () => {
  async function typed(w: World) {
    const f = async (body: Record<string, unknown>) => (await addField(w, body)).field!;
    return {
      text: await f({ label: "نص", type: "TEXT" }),
      long: await f({ label: "طويل", type: "LONG_TEXT" }),
      num: await f({ label: "رقم", type: "NUMBER", unit: "كغ" }),
      date: await f({ label: "تاريخ", type: "DATE" }),
      one: await f({ label: "واحد", type: "SINGLE_CHOICE", options: [{ label: "أ" }, { label: "ب" }] }),
      many: await f({ label: "عدة", type: "MULTI_CHOICE", options: [{ label: "س" }, { label: "ص" }] }),
      bool: await f({ label: "نعم/لا", type: "BOOLEAN" }),
      person: await f({ label: "مسؤول", type: "PERSON" }),
      link: await f({ label: "رابط", type: "LINK" }),
      money: await f({ label: "مبلغ", type: "MONEY", currency: "JOD" }),
    };
  }

  it("stores every type in its own typed column and reads it back as the same value", async () => {
    const w = await world();
    const f = await typed(w);
    await loginAs(w.member.id);
    const ok = async (id: string, v: unknown) => expect((await setValue(w.task.id, id, v)).status, JSON.stringify(v)).toBe(200);
    await ok(f.text.id, "  مرحبا  ");
    await ok(f.long.id, "سطر 1\nسطر 2");
    await ok(f.num.id, "12.5");
    await ok(f.date.id, "2026-03-05");
    await ok(f.one.id, f.one.options[1]!.id);
    await ok(f.many.id, [f.many.options[0]!.id, f.many.options[1]!.id]);
    await ok(f.bool.id, false);
    await ok(f.person.id, w.colleague.id);
    await ok(f.link.id, "https://example.com/a");
    await ok(f.money.id, 15050);

    const rows = new Map((await db.taskFieldValue.findMany({ where: { taskId: w.task.id } })).map((r) => [r.fieldId, r]));
    expect(rows.get(f.text.id)!.valueText).toBe("مرحبا");
    expect(rows.get(f.num.id)!.valueNumber!.toString()).toBe("12.5");
    expect(rows.get(f.date.id)!.valueDate!.toISOString().slice(0, 10)).toBe("2026-03-05");
    expect(rows.get(f.many.id)!.valueJson).toEqual([f.many.options[0]!.id, f.many.options[1]!.id]);
    expect(rows.get(f.bool.id)!.valueNumber!.toString()).toBe("0");
    expect(rows.get(f.money.id)!.valueNumber!.toString()).toBe("15050");
    expect(rows.get(f.money.id)!.updatedById).toBe(w.member.id);
    expect(rows.get(f.money.id)!.orgId).toBe(w.org.id);

    const read = await card(w.task.id);
    expect(read.values).toEqual({
      [f.text.id]: "مرحبا",
      [f.long.id]: "سطر 1\nسطر 2",
      [f.num.id]: "12.5",
      [f.date.id]: "2026-03-05",
      [f.one.id]: f.one.options[1]!.id,
      [f.many.id]: [f.many.options[0]!.id, f.many.options[1]!.id],
      [f.bool.id]: false,
      [f.person.id]: w.colleague.id,
      [f.link.id]: "https://example.com/a",
      [f.money.id]: 15050,
    });
    expect(read.fields.map((x) => x.label)).toEqual(["نص", "طويل", "رقم", "تاريخ", "واحد", "عدة", "نعم/لا", "مسؤول", "رابط", "مبلغ"]);
  });

  it("refuses what the type refuses: bounds, a link that is not https, a currency of another field, a day that does not exist", async () => {
    const w = await world();
    const f = await typed(w);
    await loginAs(w.member.id);
    const bad = async (id: string, v: unknown, key: string) => {
      const res = await setValue(w.task.id, id, v);
      expect(res.status, `${key} ${JSON.stringify(v)}`).toBe(422);
      expect(JSON.stringify(res.json), key).toContain(key);
    };
    await bad(f.text.id, "ا".repeat(201), "fields.text_long");
    await bad(f.long.id, "ا".repeat(2001), "fields.long_text_long");
    await bad(f.num.id, "1234567890123", "fields.number_invalid");
    await bad(f.num.id, "1.23456", "fields.number_invalid");
    await bad(f.num.id, "abc", "fields.number_invalid");
    await bad(f.date.id, "2026-02-30", "fields.date_invalid");
    await bad(f.one.id, "not-an-option", "fields.option_invalid");
    await bad(f.many.id, ["nope"], "fields.option_invalid");
    await bad(f.bool.id, "نعم", "fields.value_invalid");
    await bad(f.link.id, "http://example.com", "fields.link_invalid");
    await bad(f.link.id, "javascript:alert(1)", "fields.link_invalid");
    await bad(f.link.id, "https://user:pass@example.com", "fields.link_invalid");
    await bad(f.money.id, { amountMinor: 100, currency: "USD" }, "fields.currency_mismatch");
    await bad(f.money.id, 12.5, "fields.money_invalid");
    await bad(f.money.id, -5, "fields.money_invalid");
    expect(await db.taskFieldValue.count({ where: { taskId: w.task.id } })).toBe(0);
    // a body with no `value` key is refused: a forgotten key never clears anything
    await setValue(w.task.id, f.text.id, "باقي");
    const noKey = await call(taskFieldRoute.PUT, { method: "PUT", params: { id: w.task.id, fieldId: f.text.id }, body: {} });
    expect(noKey.status).toBe(422);
    expect(await db.taskFieldValue.count({ where: { taskId: w.task.id } })).toBe(1);
  });

  it("a person must be ACTIVE, not a guest, and in the space of the task", async () => {
    const w = await world();
    const f = await typed(w);
    const outsider = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Outsider" }); // in the company, not in the space
    const suspended = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Suspended" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: suspended.id, role: "MEMBER" } });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: suspended.id } }, data: { status: "SUSPENDED" } });
    const foreign = await makeTeam();
    await loginAs(w.member.id);
    for (const [who, id] of [["outsider", outsider.id], ["suspended", suspended.id], ["guest", w.guest.id], ["foreign", foreign.member.id], ["nobody", "does-not-exist"]] as const) {
      const res = await setValue(w.task.id, f.person.id, id);
      expect(res.status, who).toBe(422);
      expect(JSON.stringify(res.json), who).toContain("fields.person_invalid");
    }
    expect((await setValue(w.task.id, f.person.id, w.colleague.id)).status).toBe(200);
    expect((await setValue(w.task.id, f.person.id, w.admin.id)).status).toBe(200); // a space ADMIN row is staff
  });

  it("an emptied box clears the value (the row goes), and a cleared required field is missing again", async () => {
    const w = await world();
    const f = await typed(w);
    await loginAs(w.member.id);
    await setValue(w.task.id, f.text.id, "x");
    expect(await db.taskFieldValue.count({ where: { taskId: w.task.id } })).toBe(1);
    for (const empty of [null, "", "   "]) {
      await setValue(w.task.id, f.text.id, "x");
      const res = await setValue(w.task.id, f.text.id, empty);
      expect(res.status).toBe(200);
      expect((res.json as { value: unknown }).value).toBeNull();
      expect(await db.taskFieldValue.count({ where: { taskId: w.task.id } })).toBe(0);
    }
  });

  it("DECIMAL exactness: 0.1 and 0.2 are stored as typed and summed as exactly 0.3, and a number column sorts as numbers", async () => {
    const w = await world();
    const num = (await addField(w, { label: "الوزن", type: "NUMBER" })).field!;
    const t2 = await w.mk("ثانية");
    const t3 = await w.mk("ثالثة");
    await loginAs(w.member.id);
    await setValue(w.task.id, num.id, 0.1);
    await setValue(t2.id, num.id, "0.2");
    await setValue(t3.id, num.id, "10");
    const stored = await db.taskFieldValue.findMany({ where: { fieldId: num.id }, orderBy: { valueNumber: "asc" } });
    expect(stored.map((r) => r.valueNumber!.toString())).toEqual(["0.1", "0.2", "10"]);
    expect(await sumNumberField(w.org.id, w.made.project.id, num.id)).toBe("10.3");
    // a float would not agree with itself; the exact sum does
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumDecimals(stored.slice(0, 2).map((r) => r.valueNumber!.toString()))).toBe("0.3");
    await db.taskFieldValue.delete({ where: { taskId_fieldId: { taskId: t3.id, fieldId: num.id } } });
    expect(await sumNumberField(w.org.id, w.made.project.id, num.id)).toBe("0.3");
    // «10» sorts after «9» as a number, not before it as text
    await setValue(t3.id, num.id, "9");
    await setValue(w.task.id, num.id, "10");
    const asc = await queryTasksForView({ orgId: w.org.id, projectId: w.made.project.id, fieldSort: { fieldId: num.id, projectId: w.made.project.id, column: "valueNumber", dir: "asc" } });
    expect(asc.map((t) => t.id)).toEqual([t2.id, t3.id, w.task.id]);
  });
});

describe("«حقول مخصصة»: who writes a value", () => {
  it("whoever may edit the task writes; a guest is refused; a field of another project is not found; the owner who is not in the space reads and writes nothing", async () => {
    const w = await world();
    const f = (await addField(w, { label: "ملاحظة", type: "TEXT" })).field!;
    for (const [who, id] of [["member", w.member.id], ["colleague", w.colleague.id], ["admin", w.admin.id]] as const) {
      await loginAs(id);
      expect((await setValue(w.task.id, f.id, `من ${who}`)).status, who).toBe(200);
    }
    await loginAs(w.guest.id);
    expect((await setValue(w.task.id, f.id, "ضيف")).status).toBe(403);
    // another project's field
    const o = await makeProject(w.ws.id, "مشروع آخر");
    await loginAs(w.admin.id);
    const foreignField = await call(fieldsRoute.POST, { params: { id: o.project.id }, body: { label: "غريب", type: "TEXT" } });
    const foreignId = (foreignField.json as { field: { id: string } }).field.id;
    await loginAs(w.member.id);
    expect((await setValue(w.task.id, foreignId, "x")).status).toBe(404);
    expect(await db.taskFieldValue.count({ where: { fieldId: foreignId } })).toBe(0);
    // the owner is in no row of the space: he reads, he does not write
    await loginAs(w.owner.id);
    expect((await call(taskFieldsRoute.GET, { params: { id: w.task.id } })).status).toBe(200);
    const res = await setValue(w.task.id, f.id, "المالك");
    expect(res.status).toBe(403);
    expect((res.json as { message: string }).message).toBe("fields.oversight_readonly");
    expect((await db.taskFieldValue.findFirstOrThrow({ where: { taskId: w.task.id, fieldId: f.id } })).updatedById).toBe(w.admin.id);
    // ...and once he has JOINED the space he writes like anybody
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.owner.id, role: "MEMBER" } });
    expect((await setValue(w.task.id, f.id, "المالك انضم")).status).toBe(200);
  });

  it("another company's task is not found, and a project's field cannot be set on a task of another company", async () => {
    const w = await world();
    const f = (await addField(w, { label: "ملاحظة", type: "TEXT" })).field!;
    const other = await world();
    await loginAs(other.member.id);
    expect([403, 404]).toContain((await setValue(w.task.id, f.id, "x")).status);
    expect([403, 404]).toContain((await call(taskFieldsRoute.GET, { params: { id: w.task.id } })).status);
    // its own task, the other company's field id
    expect((await setValue(other.task.id, f.id, "x")).status).toBe(404);
    expect(await db.taskFieldValue.count({ where: { fieldId: f.id } })).toBe(0);
  });

  it("a reward task keeps its owner-only lock for its fields too", async () => {
    const w = await world();
    const f = (await addField(w, { label: "ملاحظة", type: "TEXT" })).field!;
    await db.task.update({ where: { id: w.task.id }, data: { rewardStatus: "OPEN", rewardAmountMinor: 5000, rewardCurrency: "JOD", dueDate: new Date(Date.now() + 86_400_000) } });
    await loginAs(w.member.id);
    const refused = await setValue(w.task.id, f.id, "x");
    expect(refused.status).toBe(403);
    expect((refused.json as { message: string }).message).toBe("reward.owner_only");
    await loginAs(w.admin.id);
    expect((await setValue(w.task.id, f.id, "x")).status).toBe(403);
    // the owner, in the space, writes
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.owner.id, role: "MEMBER" } });
    await loginAs(w.owner.id);
    expect((await setValue(w.task.id, f.id, "x")).status).toBe(200);
    // a plain task of the same project is not locked
    const plain = await w.mk("عادية");
    await loginAs(w.member.id);
    expect((await setValue(plain.id, f.id, "y")).status).toBe(200);
  });
});

describe("«حقول مخصصة»: required fields stop a completion", () => {
  async function required(w: World) {
    const a = (await addField(w, { label: "الميزانية", type: "NUMBER", required: true })).field!;
    const b = (await addField(w, { label: "المسؤول", type: "PERSON", required: true })).field!;
    const c = (await addField(w, { label: "ملاحظة", type: "TEXT" })).field!;
    return { a, b, c };
  }

  it("moving into the done column answers 422 `fields.required` with the missing labels, and the task does not move", async () => {
    const w = await world();
    const f = await required(w);
    await loginAs(w.member.id);
    const res = await move(w.task.id, w.made.done.id);
    expect(res.status).toBe(422);
    expect((res.json as { message: string }).message).toBe("fields.required");
    expect((res.json as { details: { missing: { id: string; label: string }[] } }).details.missing).toEqual([
      { id: f.a.id, label: "الميزانية" },
      { id: f.b.id, label: "المسؤول" },
    ]);
    const row = await db.task.findUniqueOrThrow({ where: { id: w.task.id } });
    expect(row.completedAt).toBeNull();
    expect(row.columnId).toBe(w.made.todo.id);
    // one answered, one still missing
    await setValue(w.task.id, f.a.id, "5");
    const half = await move(w.task.id, w.made.done.id);
    expect(half.status).toBe(422);
    expect((half.json as { details: { missing: { label: string }[] } }).details.missing.map((m) => m.label)).toEqual(["المسؤول"]);
    await setValue(w.task.id, f.b.id, w.colleague.id);
    const ok = await move(w.task.id, w.made.done.id);
    expect(ok.status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).completedAt).not.toBeNull();
  });

  it("the tick box (`setTaskCompletion`) asks the same, through the route and through the service", async () => {
    const w = await world();
    const f = await required(w);
    await loginAs(w.member.id);
    const res = await complete(w.task.id);
    expect(res.status).toBe(422);
    expect((res.json as { message: string }).message).toBe("fields.required");
    await expect(setTaskCompletion({ userId: w.member.id, orgId: w.org.id }, w.task.id, true)).rejects.toMatchObject({ name: "RequiredFieldsError" });
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).completedAt).toBeNull();
    await setValue(w.task.id, f.a.id, "0"); // zero is an answer
    await setValue(w.task.id, f.b.id, w.colleague.id);
    expect((await complete(w.task.id)).status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).completedAt).not.toBeNull();
  });

  it("both doors, for anybody who may complete: the ADMIN and the owner in the space are asked too", async () => {
    const w = await world();
    await required(w);
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.owner.id, role: "MEMBER" } });
    for (const person of [w.admin, w.owner]) {
      await loginAs(person.id);
      expect((await move(w.task.id, w.made.done.id)).status, person.name).toBe(422);
      expect((await complete(w.task.id)).status, person.name).toBe(422);
    }
  });

  it("is never asked at creation, when reopening, when moving between open columns, for a field that is optional or archived, or on a task already finished", async () => {
    const w = await world();
    const f = await required(w);
    const review = await db.boardColumn.create({ data: { boardId: w.made.board.id, name: "review", position: 2 } });
    // quick-add straight into the done column: born finished, no questions (it would break quick-add)
    const born = await createTask({ userId: w.member.id, orgId: w.org.id }, { workspaceId: w.ws.id, projectId: w.made.project.id, boardId: w.made.board.id, columnId: w.made.done.id, title: "سريعة" });
    expect(born.completedAt).not.toBeNull();
    await loginAs(w.member.id);
    expect((await move(w.task.id, review.id)).status).toBe(200); // open -> open
    // a task finished before the field was required stays finished and can be reopened
    const old = await w.mk("قديمة", { columnId: w.made.done.id });
    await db.task.update({ where: { id: old.id }, data: { completedAt: new Date() } });
    expect((await complete(old.id, false)).status).toBe(200);
    expect((await move(old.id, w.made.done.id)).status).toBe(422); // finishing it AGAIN asks
    // dragging inside the done column of a task that is already finished asks nothing
    const fin = await w.mk("منتهية", { columnId: w.made.done.id });
    await db.task.update({ where: { id: fin.id }, data: { completedAt: new Date() } });
    expect((await move(fin.id, w.made.done.id)).status).toBe(200);
    // archived and optional fields do not ask
    await loginAs(w.admin.id);
    for (const id of [f.a.id, f.b.id]) await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: id }, body: { archived: true } });
    await loginAs(w.member.id);
    expect((await move(w.task.id, w.made.done.id)).status).toBe(200);
  });

  it("a required field of ANOTHER project never blocks this one", async () => {
    const w = await world();
    const o = await makeProject(w.ws.id, "مشروع آخر");
    await loginAs(w.admin.id);
    await call(fieldsRoute.POST, { params: { id: o.project.id }, body: { label: "لهم فقط", type: "TEXT", required: true } });
    await loginAs(w.member.id);
    expect((await move(w.task.id, w.made.done.id)).status).toBe(200);
  });

  it("a completion racing a clear cannot slip past: the value write holds the task's row", async () => {
    const w = await world();
    const f = await required(w);
    await loginAs(w.member.id);
    await setValue(w.task.id, f.a.id, "1");
    await setValue(w.task.id, f.b.id, w.colleague.id);
    // clear one while a completion is asked at the same time: either it is cleared first (422) or the completion won first (200 and
    // a clear after it); it is never «completed with the field missing at the moment of the check»
    const [clear, done] = await Promise.all([setValue(w.task.id, f.a.id, null), complete(w.task.id)]);
    expect(clear.status).toBe(200);
    if (done.status === 200) {
      expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).completedAt).not.toBeNull();
    } else {
      expect(done.status).toBe(422);
      expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).completedAt).toBeNull();
    }
  });
});

describe("«حقول مخصصة»: archived, the partner, the answer of the task itself", () => {
  it("an archived field is hidden but its values are kept, and they are back when it is restored", async () => {
    const w = await world();
    const f = (await addField(w, { label: "ملاحظة", type: "TEXT" })).field!;
    await loginAs(w.member.id);
    await setValue(w.task.id, f.id, "محفوظة");
    await loginAs(w.admin.id);
    expect((await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: f.id }, body: { archived: true } })).status).toBe(200);
    await loginAs(w.member.id);
    expect(await card(w.task.id)).toMatchObject({ fields: [], values: {} });
    const refused = await setValue(w.task.id, f.id, "جديدة");
    expect(refused.status).toBe(403);
    expect((await call(fieldsRoute.GET, { params: PID(w) })).json).toEqual({ fields: [] });
    expect(await db.taskFieldValue.count({ where: { fieldId: f.id } })).toBe(1); // kept
    // the admin can list the archived ones; a member cannot
    await loginAs(w.admin.id);
    const withArchived = (await call(fieldsRoute.GET, { params: PID(w), url: "http://localhost/api/x?archived=1" })).json as { fields: { id: string; archived: boolean }[] };
    expect(withArchived.fields).toEqual([expect.objectContaining({ id: f.id, archived: true })]);
    await loginAs(w.member.id);
    expect(((await call(fieldsRoute.GET, { params: PID(w), url: "http://localhost/api/x?archived=1" })).json as { fields: unknown[] }).fields).toEqual([]);
    // restored
    await loginAs(w.admin.id);
    await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: f.id }, body: { archived: false } });
    await loginAs(w.member.id);
    expect((await card(w.task.id)).values).toEqual({ [f.id]: "محفوظة" });
  });

  it("a partner is handed NO field: no definition, no value, no money, no write — and the task's own answer carries none", async () => {
    const w = await world();
    const text = (await addField(w, { label: "ملاحظة", type: "TEXT" })).field!;
    const money = (await addField(w, { label: "الميزانية", type: "MONEY", currency: "JOD" })).field!;
    await loginAs(w.member.id);
    await setValue(w.task.id, text.id, "سري");
    await setValue(w.task.id, money.id, 999_900);
    // an org GUEST in a space they are in
    await loginAs(w.guest.id);
    expect((await call(taskFieldsRoute.GET, { params: { id: w.task.id } })).json).toEqual({ fields: [], values: {}, people: [] });
    expect((await call(fieldsRoute.GET, { params: PID(w) })).json).toEqual({ fields: [] });
    expect((await setValue(w.task.id, text.id, "x")).status).toBe(403);
    expect((await setValue(w.task.id, money.id, 1)).status).toBe(403);
    expect(await fieldCellsFor({ orgId: w.org.id, userId: w.guest.id, orgRole: "GUEST" }, w.ws.id, [{ id: w.task.id, projectId: w.made.project.id }])).toBeNull();
    // somebody whose ROW in the space says GUEST is a partner there too, whatever their company rank
    const lowered = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Lowered" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: lowered.id, role: "GUEST" } });
    await loginAs(lowered.id);
    expect((await call(taskFieldsRoute.GET, { params: { id: w.task.id } })).json).toEqual({ fields: [], values: {}, people: [] });
    expect(await fieldCellsFor({ orgId: w.org.id, userId: lowered.id }, w.ws.id, [{ id: w.task.id, projectId: w.made.project.id }])).toBeNull();
    // the task's own answer never carries a field value, to anybody: custom fields travel only through their own door
    for (const id of [w.guest.id, w.member.id]) {
      await loginAs(id);
      const task = await call(taskRoute.GET, { params: { id: w.task.id } });
      expect(task.status).toBe(200);
      expect(task.text).not.toContain("سري");
      expect(task.text).not.toContain("999900");
      expect(Object.keys((task.json as { task: Record<string, unknown> }).task)).not.toContain("fieldValues");
    }
    // staff get the chips, money included
    const staff = await fieldCellsFor({ orgId: w.org.id, userId: w.member.id, orgRole: "MEMBER" }, w.ws.id, [{ id: w.task.id, projectId: w.made.project.id }]);
    expect(staff?.cells[w.task.id]?.[money.id]?.text).toBe("9,999 دينار");
  });
});

describe("«حقول مخصصة»: filter and sort on the list, with every access rule kept", () => {
  async function listWorld() {
    const w = await world();
    const choice = (await addField(w, { label: "الحالة", type: "SINGLE_CHOICE", options: [{ label: "جاهز" }, { label: "معلّق" }] })).field!;
    const yes = (await addField(w, { label: "عاجل", type: "BOOLEAN" })).field!;
    const who = (await addField(w, { label: "المسؤول", type: "PERSON" })).field!;
    const num = (await addField(w, { label: "الكمية", type: "NUMBER" })).field!;
    const day = (await addField(w, { label: "الموعد", type: "DATE" })).field!;
    const t1 = w.task;
    const t2 = await w.mk("ثانية");
    const t3 = await w.mk("ثالثة");
    const t4 = await w.mk("رابعة");
    await loginAs(w.member.id);
    await setValue(t1.id, choice.id, choice.options[0]!.id);
    await setValue(t2.id, choice.id, choice.options[1]!.id);
    await setValue(t3.id, choice.id, choice.options[0]!.id);
    await setValue(t1.id, yes.id, true);
    await setValue(t2.id, yes.id, false);
    await setValue(t1.id, who.id, w.colleague.id);
    await setValue(t4.id, who.id, w.admin.id);
    await setValue(t1.id, num.id, "30");
    await setValue(t2.id, num.id, "4.5");
    await setValue(t3.id, num.id, "100");
    await setValue(t1.id, day.id, "2026-05-01");
    await setValue(t2.id, day.id, "2026-03-01");
    await setValue(t4.id, day.id, "2026-04-01");
    return { w, choice, yes, who, num, day, t: [t1, t2, t3, t4] as const };
  }
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

  it("filters by a single choice, by yes/no (no = everything that is not yes) and by a person", async () => {
    const { w, choice, yes, who, t } = await listWorld();
    const base = { orgId: w.org.id, projectId: w.made.project.id };
    expect(ids(await queryTasksForView({ ...base, fieldFilter: { fieldId: choice.id, kind: "text", value: choice.options[0]!.id } }))).toEqual(ids([t[0], t[2]]));
    expect(ids(await queryTasksForView({ ...base, fieldFilter: { fieldId: choice.id, kind: "text", value: choice.options[1]!.id } }))).toEqual(ids([t[1]]));
    expect(ids(await queryTasksForView({ ...base, fieldFilter: { fieldId: yes.id, kind: "boolean", value: true } }))).toEqual(ids([t[0]]));
    expect(ids(await queryTasksForView({ ...base, fieldFilter: { fieldId: yes.id, kind: "boolean", value: false } }))).toEqual(ids([t[1], t[2], t[3]]));
    expect(ids(await queryTasksForView({ ...base, fieldFilter: { fieldId: who.id, kind: "text", value: w.colleague.id } }))).toEqual(ids([t[0]]));
  });

  it("sorts by a number and by a date, either way, tasks with no value last", async () => {
    const { w, num, day, t } = await listWorld();
    const q = (fieldId: string, column: "valueNumber" | "valueDate", dir: "asc" | "desc") =>
      queryTasksForView({ orgId: w.org.id, projectId: w.made.project.id, fieldSort: { fieldId, projectId: w.made.project.id, column, dir } });
    expect((await q(num.id, "valueNumber", "asc")).map((r) => r.id)).toEqual([t[1].id, t[0].id, t[2].id, t[3].id]);
    expect((await q(num.id, "valueNumber", "desc")).map((r) => r.id)).toEqual([t[2].id, t[0].id, t[1].id, t[3].id]);
    expect((await q(day.id, "valueDate", "asc")).map((r) => r.id)).toEqual([t[1].id, t[3].id, t[0].id, t[2].id]);
    expect((await q(day.id, "valueDate", "desc")).map((r) => r.id)).toEqual([t[0].id, t[3].id, t[1].id, t[2].id]);
  });

  it("filter and sort together, with the other filters, and the limit, still apply", async () => {
    const { w, choice, num, t } = await listWorld();
    const rows = await queryTasksForView({
      orgId: w.org.id,
      projectId: w.made.project.id,
      fieldFilter: { fieldId: choice.id, kind: "text", value: choice.options[0]!.id },
      fieldSort: { fieldId: num.id, projectId: w.made.project.id, column: "valueNumber", dir: "desc" },
      limit: 1,
    });
    expect(rows.map((r) => r.id)).toEqual([t[2].id]);
    // finished tasks drop out of an open-only view, archived ones never show
    await db.task.update({ where: { id: t[2].id }, data: { completedAt: new Date() } });
    await db.task.update({ where: { id: t[0].id }, data: { archived: true } });
    const open = await queryTasksForView({
      orgId: w.org.id,
      projectId: w.made.project.id,
      openOnly: true,
      fieldSort: { fieldId: num.id, projectId: w.made.project.id, column: "valueNumber", dir: "asc" },
    });
    expect(open.map((r) => r.id)).toEqual([t[1].id, t[3].id]);
  });

  it("the list's own access rules still decide: a task the viewer may not see, another space and another company never appear", async () => {
    const { w, num, t } = await listWorld();
    const sort = { fieldId: num.id, projectId: w.made.project.id, column: "valueNumber" as const, dir: "asc" as const };
    // the teams rule (`visible`): only the first two tasks
    const some = await queryTasksForView({ orgId: w.org.id, projectId: w.made.project.id, visible: { id: { in: [t[0].id, t[1].id] } }, fieldSort: sort });
    expect(some.map((r) => r.id)).toEqual([t[1].id, t[0].id]);
    // the workspace allow-list
    expect(await queryTasksForView({ orgId: w.org.id, projectId: w.made.project.id, workspaceIds: [], fieldSort: sort })).toEqual([]);
    // another company asking with this project and this field id gets nothing, from the sort or the filter
    const other = await world();
    expect(await queryTasksForView({ orgId: other.org.id, projectId: w.made.project.id, fieldSort: sort })).toEqual([]);
    expect(await queryTasksForView({ orgId: other.org.id, fieldFilter: { fieldId: num.id, kind: "text", value: "x" } })).toEqual([]);
    // a field id that belongs to ANOTHER project of the same company sorts nothing here: no row of this project holds a value of it
    const o = await makeProject(w.ws.id, "مشروع آخر");
    await loginAs(w.admin.id);
    const foreign = (await call(fieldsRoute.POST, { params: { id: o.project.id }, body: { label: "رقم غريب", type: "NUMBER" } })).json as { field: { id: string } };
    const mixed = await queryTasksForView({ orgId: w.org.id, projectId: w.made.project.id, fieldSort: { ...sort, fieldId: foreign.field.id } });
    // all four tasks, none of them ordered by a value (every value is null: the id decides)
    expect(ids(mixed)).toEqual(ids([...t]));
    // the injection attempt is just a value: it matches nothing
    expect(await queryTasksForView({ orgId: w.org.id, fieldFilter: { fieldId: num.id, kind: "text", value: "'; DROP TABLE \"Task\"; --" } })).toEqual([]);
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(4);
  });
});

describe("«حقول مخصصة»: the switch, and what a deletion takes with it", () => {
  it("off: every door answers «not found», nothing is enforced, nothing is lost; on again: all of it is back", async () => {
    const w = await world();
    const req = (await addField(w, { label: "الميزانية", type: "NUMBER", required: true })).field!;
    await loginAs(w.member.id);
    await setValue(w.task.id, req.id, "5");
    const other = await w.mk("ثانية");
    await switchOff(w, false);

    await loginAs(w.admin.id);
    for (const res of [
      await call(fieldsRoute.GET, { params: PID(w) }),
      await call(fieldsRoute.POST, { params: PID(w), body: { label: "x", type: "TEXT" } }),
      await call(fieldRoute.PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: req.id }, body: { label: "y" } }),
      await call(taskFieldsRoute.GET, { params: { id: w.task.id } }),
      await setValue(w.task.id, req.id, "9"),
    ]) {
      expect(res.status).toBe(404);
      expect((res.json as { message: string }).message).toBe("features.off");
    }
    // a required field with no answer does not stop the completion while the switch is off
    expect((await move(other.id, w.made.done.id)).status).toBe(200);
    expect(await fieldCellsFor({ orgId: w.org.id, userId: w.member.id, orgRole: "MEMBER" }, w.ws.id, [{ id: w.task.id, projectId: w.made.project.id }])).toBeNull();
    // nothing was lost
    expect(await db.projectField.count({ where: { projectId: w.made.project.id } })).toBe(1);
    expect((await db.taskFieldValue.findFirstOrThrow({ where: { taskId: w.task.id } })).valueNumber!.toString()).toBe("5");

    await switchOff(w, true);
    await loginAs(w.member.id);
    expect((await card(w.task.id)).values).toEqual({ [req.id]: "5" });
    const third = await w.mk("ثالثة");
    expect((await move(third.id, w.made.done.id)).status).toBe(422); // asked again
  });

  it("deleting the project removes its fields and their values; deleting a task removes its values only", async () => {
    const w = await world();
    const f = (await addField(w, { label: "ملاحظة", type: "TEXT" })).field!;
    const t2 = await w.mk("ثانية");
    await loginAs(w.member.id);
    await setValue(w.task.id, f.id, "أ");
    await setValue(t2.id, f.id, "ب");
    await db.task.delete({ where: { id: t2.id } });
    expect(await db.taskFieldValue.count({ where: { fieldId: f.id } })).toBe(1);
    expect(await db.projectField.count({ where: { id: f.id } })).toBe(1);
    await db.project.delete({ where: { id: w.made.project.id } });
    expect(await db.projectField.count({ where: { projectId: w.made.project.id } })).toBe(0);
    expect(await db.taskFieldValue.count({ where: { fieldId: f.id } })).toBe(0);
  });

  it("a task that moved to another project does not show the old project's values against the new project's fields", async () => {
    const w = await world();
    const f = (await addField(w, { label: "ملاحظة", type: "TEXT" })).field!;
    await loginAs(w.member.id);
    await setValue(w.task.id, f.id, "قديمة");
    const o = await makeProject(w.ws.id, "مشروع آخر");
    await db.task.update({ where: { id: w.task.id }, data: { projectId: o.project.id, boardId: o.board.id, columnId: o.todo.id } });
    expect(await card(w.task.id)).toMatchObject({ fields: [], values: {} });
    const cells = await fieldCellsFor({ orgId: w.org.id, userId: w.member.id, orgRole: "MEMBER" }, w.ws.id, [{ id: w.task.id, projectId: o.project.id }]);
    expect(cells).toEqual({ defs: [], cells: {} });
    expect((await setValue(w.task.id, f.id, "x")).status).toBe(404);
  });
});
