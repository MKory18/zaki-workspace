import { beforeEach, describe, expect, it } from "vitest";
import { db, loginAs } from "./helpers";
import { approvalOf, approvalsWorld, archiveForm, ask, bell, createForm, decide, detailKey, detailPath, editForm, fill, flip, leaveForm, listForms, messageOf, read, readForm, resubmit } from "./approvals-helpers";
import { requireActor } from "@/server/policy/actor";
import { ApprovalConflictError } from "@/server/services/approvals";
import { updateForm } from "@/server/services/approval-forms";

/**
 * «نماذج» against a real database: who defines them (the owner and the space's ADMIN), the checks of the template and of every
 * answer by field type, the request a filled form makes (labelled lines, the preset chain), versions (an edit never changes what
 * a request was filled with), archive, and the switch. A form is data: nothing in it runs.
 */
beforeEach(() => undefined);

const FAMILY = (res: { json: Record<string, unknown> | null }) => (res.json?.["form"] as { familyId: string }).familyId;
const goodAnswers = { f1: "سنوية", f2: "2031-03-20", f3: 5, f4: "سفر عائلي\nلمدة أسبوع", f5: true, f6: "0790000000" };

describe("who defines a form", () => {
  it("the owner and the space's ADMIN create, edit and archive; a member, a guest and strangers cannot", async () => {
    const w = await approvalsWorld();
    for (const who of [w.owner, w.admin]) {
      await loginAs(who.id);
      const res = await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id], { name: `إجازة ${who.name}` }) });
      expect(res.status, who.name).toBe(201);
      const logged = await db.auditLog.findMany({ where: { action: "form.created", target: FAMILY(res) } });
      expect(logged).toHaveLength(1);
      expect(logged[0]!.actorId).toBe(who.id);
    }
    for (const who of [w.member, w.lead, w.member2]) {
      await loginAs(who.id);
      const res = await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id]) });
      expect(res.status, who.name).toBe(403);
      expect(messageOf(res), who.name).toBe("approvals.f.manage_denied");
    }
    await loginAs(w.guest.id);
    const guest = await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id]) });
    expect(guest.status).toBe(403);
    expect(messageOf(guest)).toBe("guest.no_access");
    for (const who of [w.outsider, w.foreign.owner]) {
      await loginAs(who.id);
      expect((await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id]) })).status, who.name).toBe(404);
    }
    expect(await db.formTemplate.count({ where: { orgId: w.orgId } })).toBe(2);
  });

  it("an org admin who is in the space manages its forms; a lead whose row in the space is ADMIN does too", async () => {
    const w = await approvalsWorld();
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.lead.id } }, data: { role: "ADMIN" } });
    await loginAs(w.lead.id);
    expect((await createForm({ workspaceId: w.ws.id, ...leaveForm([w.admin.id]) })).status).toBe(201);
  });

  it("everybody who works in the space reads its forms; an archived one is only for managers; a guest and a stranger read none", async () => {
    const w = await approvalsWorld();
    await loginAs(w.owner.id);
    const live = await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id], { name: "حي" }) });
    const old = await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id], { name: "قديم" }) });
    expect((await archiveForm(FAMILY(old), true)).status).toBe(200);
    const names = async (who: { id: string }) => {
      await loginAs(who.id);
      return ((await listForms(w.ws.id)).json?.["forms"] as { name: string }[]).map((f) => f.name).sort();
    };
    expect(await names(w.owner)).toEqual(["حي", "قديم"]);
    expect(await names(w.admin)).toEqual(["حي", "قديم"]);
    expect(await names(w.member)).toEqual(["حي"]);
    await loginAs(w.member.id);
    expect((await readForm(FAMILY(old))).status).toBe(404);
    expect((await readForm(FAMILY(live))).status).toBe(200);
    await loginAs(w.guest.id);
    expect((await listForms(w.ws.id)).status).toBe(403);
    expect((await readForm(FAMILY(live))).status).toBe(403);
    await loginAs(w.outsider.id);
    expect((await listForms(w.ws.id)).status).toBe(404);
    expect((await readForm(FAMILY(live))).status).toBe(404);
  });
});

describe("the template is checked: six types, up to twenty fields, nothing that runs", () => {
  it("refuses an empty form, a bad name, a bad chain, and names the field a problem is about", async () => {
    const w = await approvalsWorld();
    await loginAs(w.owner.id);
    const make = (schema: unknown, extra: Record<string, unknown> = {}) => createForm({ workspaceId: w.ws.id, name: "نموذج", schema, ...extra });
    const f = (over: Record<string, unknown> = {}) => ({ id: "f1", type: "text", label: "الاسم", required: true, ...over });
    const ok = (fields: unknown[], approvers: string[] = [w.lead.id]) => ({ fields, approvers });

    expect(detailKey(await createForm({ workspaceId: w.ws.id, name: "  ", schema: ok([f()]) }))).toBe("approvals.f.name_required");
    expect(detailKey(await createForm({ workspaceId: w.ws.id, name: "ن".repeat(81), schema: ok([f()]) }))).toBe("approvals.f.name_long");
    expect(detailKey(await make(ok([])))).toBe("approvals.f.fields_empty");
    expect(detailKey(await make(ok(Array.from({ length: 21 }, (_, i) => f({ id: `f${i + 1}` })))))).toBe("approvals.f.fields_long");
    expect((await make(ok(Array.from({ length: 20 }, (_, i) => f({ id: `f${i + 1}` }))))).status).toBe(201);
    // the chain
    expect(detailKey(await make(ok([f()], [])))).toBe("approvals.e.chain_empty");
    expect(detailKey(await make(ok([f()], [w.lead.id, w.admin.id, w.member.id, w.owner.id])))).toBe("approvals.e.chain_long");
    expect(detailKey(await make(ok([f()], [w.lead.id, w.lead.id])))).toBe("approvals.e.chain_duplicate");
    expect(detailKey(await make(ok([f()], [w.outsider.id])))).toBe("approvals.e.approver_invalid");
    expect(detailKey(await make(ok([f()], [w.guest.id])))).toBe("approvals.e.approver_invalid");
    // each field
    const bad = async (over: Record<string, unknown>, key: string, path: string) => {
      const res = await make(ok([f(over)]));
      expect(res.status, key).toBe(422);
      expect(detailKey(res), key).toBe(key);
      expect(detailPath(res), key).toBe(path);
    };
    await bad({ type: "file" }, "approvals.f.type_invalid", "fields.0.type");
    await bad({ type: "script" }, "approvals.f.type_invalid", "fields.0.type");
    await bad({ label: "  " }, "approvals.f.label_required", "fields.0.label");
    await bad({ label: "ع".repeat(81) }, "approvals.f.label_long", "fields.0.label");
    await bad({ id: "Bad Id" }, "approvals.f.id_invalid", "fields.0.id");
    await bad({ required: "yes" }, "approvals.f.required_invalid", "fields.0.required");
    await bad({ type: "choice", options: ["واحد"] }, "approvals.f.options_few", "fields.0.options");
    await bad({ type: "choice", options: Array.from({ length: 21 }, (_, i) => `خيار${i}`) }, "approvals.f.options_long", "fields.0.options");
    await bad({ type: "choice", options: ["أ", "أ"] }, "approvals.f.options_duplicate", "fields.0.options");
    await bad({ type: "choice", options: ["أ", "  "] }, "approvals.f.option_invalid", "fields.0.options");
    await bad({ type: "choice" }, "approvals.f.options_invalid", "fields.0.options");
    await bad({ type: "number", min: 10, max: 1 }, "approvals.f.bound_order", "fields.0.min");
    await bad({ type: "number", min: "ten" }, "approvals.f.bound_invalid", "fields.0.min");
    // no scripting, no formulas, no files: any property outside the type's own list is refused
    for (const extra of [{ script: "alert(1)" }, { formula: "f1*2" }, { default: "x" }, { onChange: "x" }, { accept: "image/*" }]) {
      const key = Object.keys(extra)[0]!;
      await bad(extra, "approvals.f.unknown_property", `fields.0.${key}`);
    }
    await bad({ options: ["أ", "ب"] }, "approvals.f.unknown_property", "fields.0.options"); // options belong to «اختيار» only
    await bad({ min: 1 }, "approvals.f.unknown_property", "fields.0.min"); // bounds belong to «رقم» only
    const top = await make({ fields: [f()], approvers: [w.lead.id], onSubmit: "run()" });
    expect(detailKey(top)).toBe("approvals.f.unknown_property");
    expect(await db.formTemplate.count({ where: { orgId: w.orgId, name: "نموذج" } })).toBe(1);
  });

  it("every field type is accepted when well formed", async () => {
    const w = await approvalsWorld();
    await loginAs(w.owner.id);
    const res = await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id, w.admin.id]) });
    expect(res.status).toBe(201);
    const form = res.json?.["form"] as { version: number; schema: { fields: { type: string }[] }; approvers: { name: string }[]; canManage: boolean };
    expect(form.schema.fields.map((x) => x.type)).toEqual(["choice", "date", "number", "textarea", "yesno", "text"]);
    expect(form).toMatchObject({ version: 1, canManage: true });
    expect(form.approvers.map((a) => a.name)).toEqual(["Lead", "Admin"]);
  });
});

describe("filling a form: the answers are checked per type and become a request", () => {
  it("a good filling makes a request: the form's name, the answers as labelled lines in order, the preset chain, the first approver told", async () => {
    const w = await approvalsWorld();
    await loginAs(w.owner.id);
    const family = FAMILY(await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id, w.admin.id]) }));
    await loginAs(w.member.id);
    const res = await fill(family, { answers: goodAnswers });
    expect(res.status).toBe(201);
    const a = approvalOf(res);
    expect(a).toMatchObject({ title: "طلب إجازة", status: "PENDING", version: 1, workspaceId: w.ws.id, fromForm: true });
    expect(a["details"]).toBe(["نوع الإجازة: سنوية", "من تاريخ: 20 آذار 2031", "عدد الأيام: 5", "السبب:\nسفر عائلي\nلمدة أسبوع", "سلّمت عملي: نعم", "رقم للتواصل: 0790000000"].join("\n"));
    expect(a["steps"].map((s: { approver: { id: string } }) => s.approver.id)).toEqual([w.lead.id, w.admin.id]);
    expect(a["form"]).toMatchObject({ name: "طلب إجازة", version: 1 });
    const stored = await db.approvalRequest.findUniqueOrThrow({ where: { id: a["id"] } });
    expect(stored.answers).toEqual(goodAnswers);
    expect(stored.formId).not.toBeNull();
    expect(await bell(w.lead.id, "approval_requested")).toHaveLength(1);
    expect(await bell(w.admin.id, "approval_requested")).toHaveLength(0);
    // the chain runs like any other
    await loginAs(w.lead.id);
    expect((await decide(a["id"], "APPROVE")).status).toBe(200);
  });

  it("an answer left empty is a line that says so; an optional field may be absent; a required one may not", async () => {
    const w = await approvalsWorld();
    await loginAs(w.owner.id);
    const family = FAMILY(await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id]) }));
    await loginAs(w.member.id);
    const res = await fill(family, { answers: { f1: "مرضية", f2: "2031-01-02", f3: 2 } });
    expect(res.status).toBe(201);
    expect(approvalOf(res)["details"]).toContain("السبب: لم تُملأ");
    expect(approvalOf(res)["details"]).toContain("سلّمت عملي: لم تُملأ");
    for (const required of ["f1", "f2", "f3"]) {
      const answers: Record<string, unknown> = { f1: "سنوية", f2: "2031-01-02", f3: 2 };
      delete answers[required];
      const bad = await fill(family, { answers });
      expect(bad.status, required).toBe(422);
      expect(detailKey(bad), required).toBe("approvals.f.answer_required");
      expect(detailPath(bad), required).toBe(required);
    }
    // a blank text counts as not answered
    expect(detailKey(await fill(family, { answers: { f1: "   ", f2: "2031-01-02", f3: 2 } }))).toBe("approvals.f.answer_required");
  });

  it("each type has its own rule: text length, number and its bounds, a real date, one of the options, yes or no", async () => {
    const w = await approvalsWorld();
    await loginAs(w.owner.id);
    const family = FAMILY(await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id]) }));
    await loginAs(w.member.id);
    const base = { f1: "سنوية", f2: "2031-01-02", f3: 2 };
    const refuse = async (over: Record<string, unknown>, key: string, path: string) => {
      const res = await fill(family, { answers: { ...base, ...over } });
      expect(res.status, `${path} ${key}`).toBe(422);
      expect(detailKey(res), path).toBe(key);
      expect(detailPath(res), path).toBe(path);
    };
    await refuse({ f1: "غير موجود" }, "approvals.f.choice_invalid", "f1");
    await refuse({ f1: 3 }, "approvals.f.choice_invalid", "f1");
    await refuse({ f2: "2031-02-31" }, "approvals.f.date_invalid", "f2");
    await refuse({ f2: "20/03/2031" }, "approvals.f.date_invalid", "f2");
    await refuse({ f2: 20310320 }, "approvals.f.date_invalid", "f2");
    await refuse({ f3: "5" }, "approvals.f.answer_type", "f3");
    await refuse({ f3: 0 }, "approvals.f.number_low", "f3");
    await refuse({ f3: 31 }, "approvals.f.number_high", "f3");
    await refuse({ f4: "ن".repeat(1001) }, "approvals.f.answer_long", "f4");
    await refuse({ f4: 5 }, "approvals.f.answer_type", "f4");
    await refuse({ f5: "yes" }, "approvals.f.answer_type", "f5");
    await refuse({ f6: "ر".repeat(201) }, "approvals.f.answer_long", "f6");
    await refuse({ nope: "x" }, "approvals.f.unknown_field", "nope");
    // the boundaries are fine
    for (const ok of [{ f3: 1 }, { f3: 30 }, { f3: 2.5 }, { f4: "ن".repeat(1000) }, { f5: false }, { f6: "ر".repeat(200) }]) {
      expect((await fill(family, { answers: { ...base, ...ok } })).status, JSON.stringify(Object.keys(ok))).toBe(201);
    }
    expect(await db.approvalRequest.count({ where: { orgId: w.orgId } })).toBe(6);
    // yes/no false is an answer, shown as «لا»
    const no = await fill(family, { answers: { ...base, f5: false } });
    expect(approvalOf(no)["details"]).toContain("سلّمت عملي: لا");
  });

  it("answers too long to fit one request are refused; the filler cannot be in the preset chain; a guest and strangers cannot fill", async () => {
    const w = await approvalsWorld();
    await loginAs(w.owner.id);
    const long = FAMILY(await createForm({
      workspaceId: w.ws.id,
      name: "طويل",
      schema: { fields: Array.from({ length: 6 }, (_, i) => ({ id: `f${i + 1}`, type: "textarea", label: `حقل ${i + 1}`, required: false })), approvers: [w.lead.id] },
    }));
    await loginAs(w.member.id);
    const answers = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i + 1}`, "ن".repeat(1000)]));
    expect(detailKey(await fill(long, { answers }))).toBe("approvals.f.details_long");

    await loginAs(w.owner.id);
    const mine = FAMILY(await createForm({ workspaceId: w.ws.id, ...leaveForm([w.member.id]) }));
    await loginAs(w.member.id);
    const own = await fill(mine, { answers: { f1: "سنوية", f2: "2031-01-02", f3: 2 } });
    expect(detailKey(own)).toBe("approvals.e.own_request");
    await loginAs(w.guest.id);
    expect(messageOf(await fill(mine, { answers: goodAnswers }))).toBe("guest.no_access");
    await loginAs(w.outsider.id);
    expect((await fill(mine, { answers: goodAnswers })).status).toBe(404);
    expect(await db.approvalRequest.count({ where: { orgId: w.orgId } })).toBe(0);
  });

  it("a preset approver who can no longer be asked stops the filling with a reason, and the list marks the form (⚠️ and its fix are on the page)", async () => {
    const w = await approvalsWorld();
    await loginAs(w.owner.id);
    const family = FAMILY(await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id, w.member2.id]) }));
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.orgId, userId: w.member2.id } }, data: { status: "SUSPENDED" } });
    await loginAs(w.member.id);
    const res = await fill(family, { answers: goodAnswers });
    expect(res.status).toBe(422);
    expect(detailKey(res)).toBe("approvals.f.preset_invalid");
    const listed = (await listForms(w.ws.id)).json?.["forms"] as { approverProblem: boolean }[];
    expect(listed[0]!.approverProblem).toBe(true);
    expect(await db.approvalRequest.count({ where: { orgId: w.orgId } })).toBe(0);
  });
});

describe("versions: an edit adds the next version; a request keeps the questions it was filled with", () => {
  it("editing writes version 2, closes version 1, audits it; a stale editor or a second at the same moment gets 409", async () => {
    const w = await approvalsWorld();
    await loginAs(w.owner.id);
    const family = FAMILY(await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id]) }));
    const v1 = await db.formTemplate.findFirstOrThrow({ where: { familyId: family, version: 1 } });
    const body = (name: string, extra: Record<string, unknown> = {}) => ({ ...leaveForm([w.lead.id], { name }), ...extra });

    const second = await editForm(family, body("طلب إجازة 2", { baseVersion: 1 }));
    expect(second.status).toBe(200);
    expect((second.json?.["form"] as { version: number; name: string }).version).toBe(2);
    const rows = await db.formTemplate.findMany({ where: { familyId: family }, orderBy: { version: "asc" } });
    expect(rows.map((r) => [r.version, r.isLatest, r.name])).toEqual([[1, false, "طلب إجازة"], [2, true, "طلب إجازة 2"]]);
    // version 1 keeps its questions, its name and its chain: only «the latest» moved on
    expect({ ...(await db.formTemplate.findUniqueOrThrow({ where: { id: v1.id } })), isLatest: true }).toEqual(v1);
    const logged = await db.auditLog.findMany({ where: { action: "form.updated", target: family } });
    expect(logged).toHaveLength(1);
    expect(logged[0]!.meta).toMatchObject({ from: 1, to: 2 });

    // an editor who started from version 1 is told it moved on
    const stale = await editForm(family, body("قديم", { baseVersion: 1 }));
    expect(stale.status).toBe(409);
    expect(messageOf(stale)).toBe("approvals.f.stale");
    // two editors at the same moment: one version is written
    await loginAs(w.owner.id);
    const actor = await requireActor();
    const results = await Promise.allSettled([updateForm(actor, family, { ...body("أ"), baseVersion: 2 }), updateForm(actor, family, { ...body("ب") })]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ApprovalConflictError);
    expect(await db.formTemplate.count({ where: { familyId: family } })).toBe(3);
    expect(await db.formTemplate.count({ where: { familyId: family, isLatest: true } })).toBe(1);
    // a member cannot edit
    await loginAs(w.member.id);
    expect(messageOf(await editForm(family, body("سطو")))).toBe("approvals.f.manage_denied");
  });

  it("an old request keeps its questions: a resubmit is checked against ITS version, a new filling against the latest", async () => {
    const w = await approvalsWorld();
    await loginAs(w.owner.id);
    const family = FAMILY(await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id]) }));
    await loginAs(w.member.id);
    const old = approvalOf(await fill(family, { answers: goodAnswers }));

    // version 2 drops «رقم للتواصل» and «عدد الأيام», and adds a required field
    await loginAs(w.owner.id);
    const v2 = {
      name: "طلب إجازة",
      schema: {
        fields: [
          { id: "f1", type: "choice", label: "نوع الإجازة", required: true, options: ["سنوية", "مرضية", "طارئة"] },
          { id: "f2", type: "date", label: "من تاريخ", required: true },
          { id: "f7", type: "text", label: "اسم البديل", required: true },
        ],
        approvers: [w.admin.id],
      },
    };
    expect((await editForm(family, v2)).status).toBe(200);

    // a new filling uses version 2: the new required field is needed, the dropped fields are unknown, the new option exists
    await loginAs(w.member2.id);
    expect(detailPath(await fill(family, { answers: { f1: "سنوية", f2: "2031-01-02" } }))).toBe("f7");
    expect(detailKey(await fill(family, { answers: { f1: "سنوية", f2: "2031-01-02", f7: "سارة", f3: 2 } }))).toBe("approvals.f.unknown_field");
    const fresh = await fill(family, { answers: { f1: "طارئة", f2: "2031-01-02", f7: "سارة" } });
    expect(fresh.status).toBe(201);
    expect(approvalOf(fresh)["form"]).toMatchObject({ version: 2 });
    expect(approvalOf(fresh)["steps"].map((s: { approver: { id: string } }) => s.approver.id)).toEqual([w.admin.id]);

    // the old request still reads as it was filled, and is sent back, edited and resubmitted against ITS questions (version 1)
    await loginAs(w.member.id);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: old["id"] } })).formId).toBe((await db.formTemplate.findFirstOrThrow({ where: { familyId: family, version: 1 } })).id);
    await loginAs(w.lead.id);
    expect((await decide(old["id"], "CHANGES", "غيّر الأيام")).status).toBe(200);
    await loginAs(w.member.id);
    const view = await read(old["id"]);
    const fillOf = approvalOf(view)["formFill"] as { schema: { fields: { id: string }[] }; answers: Record<string, unknown> };
    expect(fillOf.schema.fields.map((f) => f.id)).toEqual(["f1", "f2", "f3", "f4", "f5", "f6"]);
    expect(fillOf.answers).toEqual(goodAnswers);
    // version 2's field is unknown to a version-1 request; an answer of version 1 is accepted
    expect(detailKey(await resubmit(old["id"], { answers: { ...goodAnswers, f7: "سارة" } }))).toBe("approvals.f.unknown_field");
    expect(detailKey(await resubmit(old["id"], { answers: { ...goodAnswers, f3: 99 } }))).toBe("approvals.f.number_high");
    const again = await resubmit(old["id"], { answers: { ...goodAnswers, f3: 7 } });
    expect(again.status).toBe(200);
    expect(approvalOf(again)).toMatchObject({ version: 2, status: "PENDING" });
    expect(approvalOf(again)["details"]).toContain("عدد الأيام: 7");
    expect(approvalOf(again)["previous"][0]["details"]).toContain("عدد الأيام: 5");
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: old["id"] } })).answers).toEqual({ ...goodAnswers, f3: 7 });
    // a request that did not come from a form cannot be resubmitted through answers; a stranger is not told anything about one that did
    const plain = await ask(w, w.member, [w.lead.id]);
    await loginAs(w.lead.id);
    await decide(plain, "CHANGES", "عدّل");
    await loginAs(w.member.id);
    expect(detailKey(await resubmit(plain, { answers: { f1: "x" } }))).toBe("approvals.f.not_a_form");
    await loginAs(w.outsider.id);
    expect((await resubmit(old["id"], { answers: goodAnswers })).status).toBe(404);
    await loginAs(w.member2.id);
    expect((await resubmit(old["id"], { answers: { zzz: 1 } })).status).toBe(404);
  });

  it("archive: not offered for filling (409), requests made from it are untouched, restoring brings it back; an edit keeps it archived", async () => {
    const w = await approvalsWorld();
    await loginAs(w.owner.id);
    const family = FAMILY(await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id]) }));
    await loginAs(w.member.id);
    const made = approvalOf(await fill(family, { answers: goodAnswers }));
    expect(messageOf(await archiveForm(family, true))).toBe("approvals.f.manage_denied");
    await loginAs(w.owner.id);
    expect((await archiveForm(family, true)).status).toBe(200);
    expect((await db.auditLog.findMany({ where: { action: "form.archived", target: family } })).length).toBe(1);
    await loginAs(w.member.id);
    const refused = await fill(family, { answers: goodAnswers });
    expect(refused.status).toBe(409);
    expect(messageOf(refused)).toBe("approvals.f.archived");
    expect((await readForm(family)).status).toBe(404); // a member no longer finds it in the list or by its address
    await loginAs(w.owner.id);
    expect(messageOf(await fill(family, { answers: { ...goodAnswers } }))).toBe("approvals.f.archived");
    expect((await editForm(family, leaveForm([w.lead.id]))).status).toBe(200);
    expect(((await listForms(w.ws.id)).json?.["forms"] as { archived: boolean }[])[0]!.archived).toBe(true);
    expect((await archiveForm(family, false)).status).toBe(200);
    await loginAs(w.member.id);
    expect((await fill(family, { answers: goodAnswers })).status).toBe(201);
    // nothing was deleted
    expect(await db.approvalRequest.findUnique({ where: { id: made["id"] } })).not.toBeNull();
    expect(await db.formTemplate.count({ where: { familyId: family } })).toBe(2);
  });
});

describe("«الميزات»: the switch also closes the forms", () => {
  it("off, every form route is 404 features.off; on again, the forms are back", async () => {
    const w = await approvalsWorld();
    await loginAs(w.owner.id);
    const family = FAMILY(await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id]) }));
    expect((await flip("approvals", false)).status).toBe(200);
    for (const who of [w.owner, w.member]) {
      await loginAs(who.id);
      for (const res of [await listForms(w.ws.id), await readForm(family), await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id]) }), await editForm(family, leaveForm([w.lead.id])), await fill(family, { answers: goodAnswers }), await archiveForm(family, true)]) {
        expect(res.status, who.name).toBe(404);
        expect(messageOf(res), who.name).toBe("features.off");
      }
    }
    expect(await db.formTemplate.count({ where: { familyId: family } })).toBe(1);
    await loginAs(w.owner.id);
    expect((await flip("approvals", true)).status).toBe(200);
    await loginAs(w.member.id);
    expect((await listForms(w.ws.id)).status).toBe(200);
  });
});
