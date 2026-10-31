import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { setPushSenderForTests, type PushMessage } from "@/server/calls/push";
import { flushPushesForTests } from "@/server/notify";
import { purgeOrphanUploads } from "@/server/chat/attachments";
import { assertMayReadFile } from "@/server/services/files";
import { requireActor } from "@/server/policy/actor";
import { ApprovalConflictError, cancelApproval, decideApproval } from "@/server/services/approvals";
import { db, loginAs, makeProject, makeTask } from "./helpers";
import { approvalOf, approvalsWorld, approvers, ask, bell, cancel, create, decide, detailKey, detailPath, flip, list, makeUpload, messageOf, read, resubmit, type AWorld } from "./approvals-helpers";

/**
 * «طلبات الموافقة» against a real database: the chain (in order, one step at a time, only the current approver told), the
 * rule that nobody approves their own request, exactly-once decisions (approve and reject at the same moment: one wins, the other
 * gets 409), the written reason, «اطلب تعديل» and the new version, cancel as a status, the audit rows, the bell and the phone
 * (no amount, no details), the space walls, the guest wall, the owner's silent reading and the switch.
 * An approval only records a decision: nothing here moves money.
 */
const sent: PushMessage[] = [];
beforeEach(() => {
  sent.length = 0;
  setPushSenderForTests(async (_sub, payload) => {
    sent.push(JSON.parse(payload) as PushMessage);
    return { statusCode: 201 };
  });
});
afterAll(() => setPushSenderForTests(null));

const stepsOf = (id: string, version?: number) => db.approvalStep.findMany({ where: { requestId: id, ...(version ? { version } : {}) }, orderBy: [{ version: "asc" }, { position: "asc" }] });
const row = (id: string) => db.approvalRequest.findUniqueOrThrow({ where: { id } });
const audits = (id: string) => db.auditLog.findMany({ where: { target: id, action: { startsWith: "approval." } }, orderBy: { createdAt: "asc" } });

describe("asking: the chain, its limits and who may be asked", () => {
  it("a member asks a chain of two: the request, its steps in order, the audit row — and ONLY the first approver is told", async () => {
    const w = await approvalsWorld();
    await loginAs(w.member.id);
    const res = await create({ workspaceId: w.ws.id, title: "  شراء   جهاز  ", details: "جهاز جديد", amount: "12.5", currency: "JOD", approverIds: [w.lead.id, w.admin.id] });
    expect(res.status).toBe(201);
    const a = approvalOf(res);
    expect(a).toMatchObject({ title: "شراء جهاز", status: "PENDING", version: 1, currentStep: 1, amount: { minor: 1250, currency: "JOD" } });
    expect(a["steps"].map((s: { approver: { id: string } }) => s.approver.id)).toEqual([w.lead.id, w.admin.id]);
    const steps = await stepsOf(a["id"]);
    expect(steps.map((s) => [s.position, s.version, s.status, s.notifiedAt !== null])).toEqual([[1, 1, "PENDING", true], [2, 1, "PENDING", false]]);
    // the first approver has the bell; the second has nothing yet; nobody else has anything
    expect(await bell(w.lead.id, "approval_requested")).toHaveLength(1);
    expect(await bell(w.admin.id, "approval_requested")).toHaveLength(0);
    expect(await db.notification.count({ where: { userId: { in: [w.member2.id, w.owner.id, w.member.id] }, type: { startsWith: "approval_" } } })).toBe(0);
    const logged = await audits(a["id"]);
    expect(logged.map((l) => l.action)).toEqual(["approval.requested"]);
    expect(logged[0]).toMatchObject({ actorId: w.member.id, orgId: w.orgId, workspaceId: w.ws.id });
    // the amount itself is not copied into the log
    expect(JSON.stringify(logged[0]!.meta)).not.toContain("1250");
  });

  it("a request with no amount has none; the amount needs its currency, a plain positive number, and a cap", async () => {
    const w = await approvalsWorld();
    await loginAs(w.member.id);
    const plain = await create({ workspaceId: w.ws.id, title: "بدون مبلغ", approverIds: [w.lead.id] });
    expect(plain.status).toBe(201);
    expect(approvalOf(plain)["amount"]).toBeNull();
    const base = { workspaceId: w.ws.id, title: "مبلغ", approverIds: [w.lead.id] };
    expect(detailKey(await create({ ...base, amount: "10" }))).toBe("approvals.e.currency_invalid");
    expect(detailKey(await create({ ...base, currency: "USD" }))).toBe("approvals.e.amount_invalid");
    for (const bad of ["abc", "-5", "0", "1.234", "10000001"]) expect(detailKey(await create({ ...base, amount: bad, currency: "USD" })), bad).toBe("approvals.e.amount_invalid");
    expect(detailKey(await create({ ...base, amount: "10", currency: "XYZ" }))).toBe("approvals.e.currency_invalid");
    expect(await db.approvalRequest.count({ where: { orgId: w.orgId } })).toBe(1);
  });

  it("title, details and the chain are checked: title needed, details at most 4000, one to three approvers, each once, never the requester", async () => {
    const w = await approvalsWorld();
    await loginAs(w.member.id);
    const base = { workspaceId: w.ws.id, title: "طلب", approverIds: [w.lead.id] };
    expect(detailKey(await create({ ...base, title: "   " }))).toBe("approvals.e.title_required");
    expect(detailKey(await create({ ...base, title: "ع".repeat(201) }))).toBe("approvals.e.title_long");
    expect(detailKey(await create({ ...base, details: "ت".repeat(4001) }))).toBe("approvals.e.details_long");
    expect((await create({ ...base, details: "ت".repeat(4000) })).status).toBe(201);
    expect(detailKey(await create({ ...base, approverIds: [] }))).toBe("approvals.e.chain_empty");
    expect(detailKey(await create({ ...base, approverIds: [w.lead.id, w.admin.id, w.member2.id, w.owner.id] }))).toBe("approvals.e.chain_long");
    expect(detailKey(await create({ ...base, approverIds: [w.lead.id, w.lead.id] }))).toBe("approvals.e.chain_duplicate");
    // nobody approves their own request, alone or in a chain
    expect(detailKey(await create({ ...base, approverIds: [w.member.id] }))).toBe("approvals.e.own_request");
    expect(detailKey(await create({ ...base, approverIds: [w.lead.id, w.member.id] }))).toBe("approvals.e.own_request");
    expect((await create({ ...base, approverIds: [w.lead.id, w.admin.id, w.owner.id] })).status).toBe(201);
  });

  it("any rank may be asked — a lead asks a member, a member asks the owner — but only people who work in the space", async () => {
    const w = await approvalsWorld();
    // higher ranks (natural) and a lower rank (no rank restriction), the owner without a row in the space
    for (const [as, who] of [[w.member, w.owner], [w.member, w.admin], [w.lead, w.member2], [w.admin, w.member]] as const) {
      await loginAs(as.id);
      expect((await create({ workspaceId: w.ws.id, title: "x", approverIds: [who.id] })).status, `${as.name} → ${who.name}`).toBe(201);
    }
    await loginAs(w.member.id);
    const asked = (approverIds: string[]) => create({ workspaceId: w.ws.id, title: "x", approverIds });
    // not in the space (works only in another one), a guest, a person of another company, a person who does not exist
    for (const who of [w.outsider.id, w.guest.id, w.foreign.member.id, "ghost"]) expect(detailKey(await asked([who])), who).toBe("approvals.e.approver_invalid");
    // somebody whose row in the space says GUEST is not asked either
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.member2.id } }, data: { role: "GUEST" } });
    expect(detailKey(await asked([w.member2.id]))).toBe("approvals.e.approver_invalid");
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.member2.id } }, data: { role: "MEMBER" } });
    expect((await asked([w.member2.id])).status).toBe(201);
    // suspended, offboarded: no longer asked
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.orgId, userId: w.member2.id } }, data: { status: "SUSPENDED" } });
    expect(detailKey(await asked([w.member2.id]))).toBe("approvals.e.approver_invalid");
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.orgId, userId: w.lead.id } }, data: { status: "OFFBOARDED" } });
    expect(detailKey(await asked([w.lead.id]))).toBe("approvals.e.approver_invalid");
    expect(detailKey(await asked([w.admin.id, w.lead.id]))).toBe("approvals.e.approver_invalid");
  });

  it("the approvers list offers the people of the space (the owner included), never the asker, a guest or somebody outside", async () => {
    const w = await approvalsWorld();
    await loginAs(w.member.id);
    const res = await approvers(w.ws.id);
    expect(res.status).toBe(200);
    const ids = (res.json?.["approvers"] as { id: string }[]).map((p) => p.id).sort();
    expect(ids).toEqual([w.owner.id, w.admin.id, w.lead.id, w.member2.id].sort());
    expect((await approvers(w.other.id)).status).toBe(200); // the member works in the other space too: there the outsider is a candidate
    await loginAs(w.outsider.id);
    expect((await approvers(w.ws.id)).status).toBe(404);
  });

  it("who may ask: a guest never (403), a person outside the space or the company never (404, the space says nothing); an archived space refuses", async () => {
    const w = await approvalsWorld();
    const body = { workspaceId: w.ws.id, title: "x", approverIds: [w.lead.id] };
    await loginAs(w.guest.id);
    const guest = await create(body);
    expect(guest.status).toBe(403);
    expect(messageOf(guest)).toBe("guest.no_access");
    for (const who of [w.outsider, w.foreign.member]) {
      await loginAs(who.id);
      const res = await create(body);
      expect(res.status, who.name).toBe(404);
    }
    await loginAs(w.member.id);
    expect((await create({ ...body, workspaceId: "nowhere" })).status).toBe(404);
    await db.workspace.update({ where: { id: w.ws.id }, data: { archivedAt: new Date() } });
    const archived = await create(body);
    expect(archived.status).toBe(403);
    expect(messageOf(archived)).toBe("approvals.e.space_archived");
    expect(await db.approvalRequest.count({ where: { orgId: w.orgId } })).toBe(0);
  });

  it("a link to a task of the same space is kept; a task of another space, or one that does not exist, is refused", async () => {
    const w = await approvalsWorld();
    const made = await makeProject(w.ws.id, "مشروع");
    const task = await makeTask({ orgId: w.orgId, workspaceId: w.ws.id, projectId: made.project.id, boardId: made.board.id, columnId: made.todo.id, creatorId: w.owner.id, assigneeId: w.member.id, title: "مهمة" });
    const elsewhere = await makeProject(w.other.id, "آخر");
    const far = await makeTask({ orgId: w.orgId, workspaceId: w.other.id, projectId: elsewhere.project.id, boardId: elsewhere.board.id, columnId: elsewhere.todo.id, creatorId: w.owner.id, assigneeId: w.outsider.id, title: "بعيدة" });
    await loginAs(w.member.id);
    const base = { workspaceId: w.ws.id, title: "عن مهمة", approverIds: [w.lead.id] };
    const ok = await create({ ...base, link: { kind: "TASK", id: task.id } });
    expect(ok.status).toBe(201);
    expect(approvalOf(ok)["linkedTo"]).toEqual({ kind: "TASK", id: task.id, href: `/tasks/${task.id}` });
    expect(detailKey(await create({ ...base, link: { kind: "TASK", id: far.id } }))).toBe("approvals.e.link_invalid");
    expect(detailKey(await create({ ...base, link: { kind: "CARD", id: "nothing" } }))).toBe("approvals.e.link_invalid");
    expect(detailKey(await create({ ...base, link: { kind: "MESSAGE", id: "nothing" } }))).toBe("approvals.e.link_invalid");
  });
});

describe("the chain advances one approver at a time", () => {
  it("two approvers: the second is told only when the first approves, cannot decide before, and the last approval finishes it", async () => {
    const w = await approvalsWorld();
    const id = await ask(w, w.member, [w.lead.id, w.admin.id]);

    // the second approver's turn has not come: refused, and nothing changed
    await loginAs(w.admin.id);
    const early = await decide(id, "APPROVE");
    expect(early.status).toBe(403);
    expect(messageOf(early)).toBe("approvals.e.not_your_turn");
    expect((await stepsOf(id)).map((s) => s.status)).toEqual(["PENDING", "PENDING"]);

    await loginAs(w.lead.id);
    const first = await decide(id, "APPROVE", "  لا مانع  ");
    expect(first.status).toBe(200);
    expect(approvalOf(first)).toMatchObject({ status: "PENDING", currentStep: 2 });
    const afterFirst = await stepsOf(id);
    expect(afterFirst.map((s) => [s.status, s.reason, s.decidedAt !== null, s.notifiedAt !== null])).toEqual([["APPROVED", "لا مانع", true, true], ["PENDING", null, false, true]]);
    // now — and only now — the second approver is told; the requester hears that a step passed
    expect(await bell(w.admin.id, "approval_requested")).toHaveLength(1);
    expect(await bell(w.member.id, "approval_decided")).toHaveLength(1);

    // the first approver can not decide twice
    await loginAs(w.lead.id);
    expect(messageOf(await decide(id, "REJECT", "غيرت رأيي"))).toBe("approvals.e.already_decided");

    await loginAs(w.admin.id);
    const last = await decide(id, "APPROVE");
    expect(last.status).toBe(200);
    expect(approvalOf(last)).toMatchObject({ status: "APPROVED" });
    const done = await row(id);
    expect(done.status).toBe("APPROVED");
    expect(done.decidedAt).not.toBeNull();
    expect((await stepsOf(id)).every((s) => s.status === "APPROVED")).toBe(true);
    // the requester and the first approver are told it is approved
    expect((await bell(w.member.id, "approval_decided")).length).toBe(2);
    expect((await bell(w.lead.id, "approval_decided")).length).toBe(1);
    expect((await audits(id)).map((l) => l.action)).toEqual(["approval.requested", "approval.step_approved", "approval.approved"]);
    // nothing more can be decided
    expect(messageOf(await decide(id, "APPROVE"))).toBe("approvals.e.not_pending");
  });

  it("a rejection needs a written reason, ends the chain, skips the steps that never came and tells the requester — not the ones never reached", async () => {
    const w = await approvalsWorld();
    const id = await ask(w, w.member, [w.lead.id, w.admin.id, w.member2.id]);
    await loginAs(w.lead.id);
    await decide(id, "APPROVE");
    await loginAs(w.admin.id);
    const blank = await decide(id, "REJECT", "   ");
    expect(blank.status).toBe(422);
    expect(detailKey(blank)).toBe("approvals.e.reason_required");
    expect(detailPath(blank)).toBe("reason");
    expect(detailKey(await decide(id, "REJECT"))).toBe("approvals.e.reason_required");
    expect(detailKey(await decide(id, "REJECT", "ر".repeat(1001)))).toBe("approvals.e.reason_long");
    expect((await row(id)).status).toBe("PENDING");

    expect((await decide(id, "REJECT", "الميزانية لا تسمح")).status).toBe(200);
    const done = await row(id);
    expect(done.status).toBe("REJECTED");
    expect(done.decidedAt).not.toBeNull();
    const steps = await stepsOf(id);
    expect(steps.map((s) => s.status)).toEqual(["APPROVED", "REJECTED", "SKIPPED"]);
    expect(steps[1]).toMatchObject({ reason: "الميزانية لا تسمح", approverId: w.admin.id });
    expect(steps[1]!.decidedAt).not.toBeNull();
    // the third approver was never told anything, and the requester and the first approver were
    expect(await db.notification.count({ where: { userId: w.member2.id, type: { startsWith: "approval_" } } })).toBe(0);
    expect((await bell(w.lead.id, "approval_decided")).length).toBe(1);
    expect((await bell(w.member.id, "approval_decided")).length).toBe(2);
    expect((await audits(id)).map((l) => l.action)).toEqual(["approval.requested", "approval.step_approved", "approval.rejected"]);
    expect((await audits(id)).at(-1)!.meta).toMatchObject({ reason: "الميزانية لا تسمح", position: 2 });
    // it is over: the skipped approver cannot decide either
    await loginAs(w.member2.id);
    expect(messageOf(await decide(id, "APPROVE"))).toBe("approvals.e.not_pending");
  });

  it("only a named approver decides: the asker, a space admin, the owner and strangers never do (the owner decides as himself when he IS named)", async () => {
    const w = await approvalsWorld();
    const id = await ask(w, w.member, [w.lead.id]);
    // readers of the request who are not its approver: refused (403), nothing changes
    for (const who of [w.member, w.admin, w.owner]) {
      await loginAs(who.id);
      const res = await decide(id, "APPROVE");
      expect(res.status, who.name).toBe(403);
      expect(messageOf(res), who.name).toBe("approvals.e.not_approver");
    }
    // strangers do not even learn it exists
    for (const who of [w.member2, w.outsider, w.foreign.member]) {
      await loginAs(who.id);
      expect((await decide(id, "APPROVE")).status, who.name).toBe(404);
    }
    await loginAs(w.guest.id);
    expect((await decide(id, "APPROVE")).status).toBe(403);
    expect((await row(id)).status).toBe("PENDING");

    // the owner named as the approver decides like anybody
    const named = await ask(w, w.member, [w.owner.id]);
    await loginAs(w.owner.id);
    expect((await list("?view=waiting")).json?.["approvals"]).toHaveLength(1);
    expect((await decide(named, "APPROVE")).status).toBe(200);
    expect((await row(named)).status).toBe("APPROVED");
  });

  it("approve and reject at the same moment: one wins, the other is 409, and exactly one decision is recorded", async () => {
    const w = await approvalsWorld();
    for (let round = 0; round < 3; round += 1) {
      const id = await ask(w, w.member, [w.lead.id, w.admin.id]);
      await loginAs(w.lead.id);
      const results = await Promise.all([decide(id, "APPROVE"), decide(id, "REJECT", "رفض متزامن"), decide(id, "APPROVE")]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses, `round ${round}`).toEqual([200, 409, 409]);
      const losers = results.filter((r) => r.status === 409);
      for (const loser of losers) expect(["approvals.e.already_decided", "approvals.e.not_pending"]).toContain(messageOf(loser));
      const steps = await stepsOf(id);
      // exactly one step was decided by the first approver, and the request agrees with whichever won
      expect(steps.filter((s) => s.status !== "PENDING" && s.status !== "SKIPPED")).toHaveLength(1);
      const winner = results.find((r) => r.status === 200)!;
      expect(approvalOf(winner)["status"]).toBe((await row(id)).status);
      const decisions = (await audits(id)).filter((l) => l.action !== "approval.requested");
      expect(decisions).toHaveLength(1);
    }
  });

  it("changes requested without a note is refused; the note is stored with the step", async () => {
    const w = await approvalsWorld();
    const id = await ask(w, w.member, [w.lead.id]);
    await loginAs(w.lead.id);
    expect(detailKey(await decide(id, "CHANGES", "  "))).toBe("approvals.e.changes_required");
    expect((await row(id)).status).toBe("PENDING");
  });
});

describe("«اطلب تعديل»: back to the requester, resubmit as a new version, history kept", () => {
  it("the requester is told, edits and resubmits: version 2, the old steps and files stay under version 1, the chain restarts at its first approver", async () => {
    const w = await approvalsWorld();
    const file1 = await makeUpload(w.orgId, w.member.id, "الأول.pdf");
    const id = await ask(w, w.member, [w.lead.id, w.admin.id], { amount: "100", currency: "USD", fileIds: [file1.id] });
    await loginAs(w.lead.id);
    await decide(id, "APPROVE");
    await loginAs(w.admin.id);
    const sentBack = await decide(id, "CHANGES", "أضف عرض سعر ثانٍ");
    expect(sentBack.status).toBe(200);
    expect(approvalOf(sentBack)["status"]).toBe("CHANGES_REQUESTED");
    const mid = await stepsOf(id);
    expect(mid.map((s) => s.status)).toEqual(["APPROVED", "CHANGES_REQUESTED"]);
    // the requester gets «طُلب تعديل», the approver who already approved hears it was sent back
    expect(await bell(w.member.id, "approval_changes")).toHaveLength(1);
    expect((await bell(w.lead.id, "approval_decided")).length).toBe(1);
    expect((await audits(id)).at(-1)!.action).toBe("approval.changes_requested");

    // the asker edits: a second file, a new amount, a title
    const file2 = await makeUpload(w.orgId, w.member.id, "الثاني.pdf");
    await loginAs(w.member.id);
    const again = await resubmit(id, { title: "شراء جهاز (معدّل)", amount: "90", currency: "USD", fileIds: [file1.id, file2.id] });
    expect(again.status).toBe(200);
    const a = approvalOf(again);
    expect(a).toMatchObject({ status: "PENDING", version: 2, currentStep: 1, title: "شراء جهاز (معدّل)", amount: { minor: 9000, currency: "USD" } });
    expect(a["attachments"].map((f: { name: string }) => f.name).sort()).toEqual(["الأول.pdf", "الثاني.pdf"].sort());

    // history: version 1 is kept with its content, its steps and its files
    expect(a["previous"]).toHaveLength(1);
    expect(a["previous"][0]).toMatchObject({ version: 1, title: "شراء جهاز", amountMinor: 10000, currency: "USD" });
    expect(a["previous"][0]["steps"].map((s: { status: string }) => s.status)).toEqual(["APPROVED", "CHANGES_REQUESTED"]);
    expect(a["previous"][0]["attachments"].map((f: { name: string }) => f.name)).toEqual(["الأول.pdf"]);
    const all = await stepsOf(id);
    expect(all.map((s) => [s.version, s.position, s.status])).toEqual([[1, 1, "APPROVED"], [1, 2, "CHANGES_REQUESTED"], [2, 1, "PENDING"], [2, 2, "PENDING"]]);
    // the first approver is asked again — a second bell — and the second one is not (his turn has not come)
    expect(await bell(w.lead.id, "approval_requested")).toHaveLength(2);
    expect(await bell(w.admin.id, "approval_requested")).toHaveLength(1);
    expect((await audits(id)).at(-1)!.action).toBe("approval.resubmitted");

    // the chain runs again from the start, and a resubmitted request can be sent back again (version 3)
    await loginAs(w.lead.id);
    expect((await decide(id, "CHANGES", "مرة ثانية")).status).toBe(200);
    await loginAs(w.member.id);
    const third = await resubmit(id, { details: "تفاصيل جديدة", approverIds: [w.member2.id] });
    expect(third.status).toBe(200);
    expect(approvalOf(third)).toMatchObject({ version: 3, details: "تفاصيل جديدة" });
    expect(approvalOf(third)["steps"].map((s: { approver: { id: string } }) => s.approver.id)).toEqual([w.member2.id]);
    expect(approvalOf(third)["previous"]).toHaveLength(2);
    expect(await bell(w.member2.id, "approval_requested")).toHaveLength(1);
  });

  it("only the requester resubmits, and only from «مطلوب تعديل»: a pending, approved or cancelled request is 409; the amount can be cleared", async () => {
    const w = await approvalsWorld();
    const id = await ask(w, w.member, [w.lead.id], { amount: "5", currency: "EUR" });
    await loginAs(w.member.id);
    expect(messageOf(await resubmit(id, { title: "x" }))).toBe("approvals.e.not_resubmittable");
    await loginAs(w.lead.id);
    await decide(id, "CHANGES", "عدّل");
    for (const who of [w.lead, w.admin, w.owner]) {
      await loginAs(who.id);
      const res = await resubmit(id, { title: "سطو" });
      expect(res.status, who.name).toBe(403);
      expect(messageOf(res), who.name).toBe("approvals.e.requester_only");
    }
    await loginAs(w.member2.id);
    expect((await resubmit(id, { title: "سطو" })).status).toBe(404);
    expect((await row(id)).title).toBe("شراء جهاز");
    await loginAs(w.member.id);
    // an empty amount clears it; a link and a bad chain are checked again
    expect(detailKey(await resubmit(id, { approverIds: [w.member.id] }))).toBe("approvals.e.own_request");
    expect(detailKey(await resubmit(id, { approverIds: [w.outsider.id] }))).toBe("approvals.e.approver_invalid");
    const ok = await resubmit(id, { amount: null, currency: null });
    expect(ok.status).toBe(200);
    expect(approvalOf(ok)["amount"]).toBeNull();
    expect(messageOf(await resubmit(id, { title: "ثانية" }))).toBe("approvals.e.not_resubmittable");
  });

  it("two resubmits at the same moment make one new version", async () => {
    const w = await approvalsWorld();
    const id = await ask(w, w.member, [w.lead.id]);
    await loginAs(w.lead.id);
    await decide(id, "CHANGES", "عدّل");
    await loginAs(w.member.id);
    const results = await Promise.all([resubmit(id, { title: "أ" }), resubmit(id, { title: "ب" })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await row(id)).version).toBe(2);
    expect(await db.approvalStep.count({ where: { requestId: id, version: 2 } })).toBe(1);
  });

  it("a file already claimed by a message or held by another request, or somebody else's, is refused; the same request keeps its own across versions", async () => {
    const w = await approvalsWorld();
    const mine = await makeUpload(w.orgId, w.member.id);
    const theirs = await makeUpload(w.orgId, w.member2.id);
    await loginAs(w.member.id);
    const base = { workspaceId: w.ws.id, title: "ملفات", approverIds: [w.lead.id] };
    expect(detailKey(await create({ ...base, fileIds: [theirs.id] }))).toBe("approvals.e.file_invalid");
    expect(detailKey(await create({ ...base, fileIds: ["ghost"] }))).toBe("approvals.e.file_invalid");
    expect(detailKey(await create({ ...base, fileIds: Array.from({ length: 11 }, (_, i) => `f${i}`) }))).toBe("approvals.e.files_many");
    const first = await create({ ...base, fileIds: [mine.id] });
    expect(first.status).toBe(201);
    // one file is held by one request: a second request cannot take it
    expect(detailKey(await create({ ...base, fileIds: [mine.id] }))).toBe("approvals.e.file_invalid");
    // a file a chat message holds is not free
    const claimed = await makeUpload(w.orgId, w.member.id);
    const topic = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.ws.id, title: "t" } });
    const message = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: topic.id, authorId: w.member.id, body: "m" } });
    await db.messageAttachment.create({ data: { messageId: message.id, fileId: claimed.id, kind: "FILE", position: 0 } });
    expect(detailKey(await create({ ...base, fileIds: [claimed.id] }))).toBe("approvals.e.file_invalid");
  });
});

describe("«ألغِ الطلب»: a status, never a deletion", () => {
  it("the requester cancels while it is pending: CANCELLED, the unreached steps skipped, the approvers who were told hear it, the row stays", async () => {
    const w = await approvalsWorld();
    const id = await ask(w, w.member, [w.lead.id, w.admin.id]);
    await loginAs(w.lead.id);
    await decide(id, "APPROVE");
    // somebody else cannot cancel it: the approver gets 403, a stranger 404
    expect(messageOf(await cancel(id))).toBe("approvals.e.requester_only");
    await loginAs(w.member2.id);
    expect((await cancel(id)).status).toBe(404);
    await loginAs(w.member.id);
    const res = await cancel(id);
    expect(res.status).toBe(200);
    expect(approvalOf(res)["status"]).toBe("CANCELLED");
    const done = await row(id);
    expect(done).toMatchObject({ status: "CANCELLED" });
    expect(done.decidedAt).not.toBeNull();
    expect((await stepsOf(id)).map((s) => s.status)).toEqual(["APPROVED", "SKIPPED"]);
    // the two who had been told (the first and the second approver) hear it; nobody else
    expect((await bell(w.lead.id, "approval_decided")).length).toBe(1);
    expect((await bell(w.admin.id, "approval_decided")).length).toBe(1);
    expect(await bell(w.member2.id, "approval_decided")).toHaveLength(0);
    expect((await audits(id)).at(-1)!.action).toBe("approval.cancelled");
    // it can be neither decided nor cancelled again, and it is still there for everybody who may read it
    await loginAs(w.admin.id);
    expect(messageOf(await decide(id, "APPROVE"))).toBe("approvals.e.not_pending");
    await loginAs(w.member.id);
    expect(messageOf(await cancel(id))).toBe("approvals.e.not_cancellable");
    expect((await read(id)).status).toBe(200);
    expect(await db.approvalRequest.count({ where: { id } })).toBe(1);
  });

  it("an approved or rejected request cannot be cancelled; a request sent back can (the asker gives it up)", async () => {
    const w = await approvalsWorld();
    const done = await ask(w, w.member, [w.lead.id]);
    await loginAs(w.lead.id);
    await decide(done, "APPROVE");
    await loginAs(w.member.id);
    expect(messageOf(await cancel(done))).toBe("approvals.e.not_cancellable");
    const back = await ask(w, w.member, [w.lead.id]);
    await loginAs(w.lead.id);
    await decide(back, "CHANGES", "عدّل");
    await loginAs(w.member.id);
    expect((await cancel(back)).status).toBe(200);
    expect((await row(back)).status).toBe("CANCELLED");
  });

  it("cancel at the same moment as the decision: exactly one wins, the other is refused with the conflict", async () => {
    const w = await approvalsWorld();
    for (let i = 0; i < 4; i += 1) {
      const id = await ask(w, w.member, [w.lead.id]);
      await loginAs(w.lead.id);
      const approver = await requireActor();
      await loginAs(w.member.id);
      const requester = await requireActor();
      const [a, b] = await Promise.allSettled([decideApproval(approver, id, { decision: "APPROVE" }), cancelApproval(requester, id)]);
      expect([a.status, b.status].sort(), `round ${i}`).toEqual(["fulfilled", "rejected"]);
      const lost = (a.status === "rejected" ? a : b) as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(ApprovalConflictError);
      expect(["APPROVED", "CANCELLED"]).toContain((await row(id)).status);
      // exactly one decision or cancellation was audited
      expect((await audits(id)).filter((l) => l.action !== "approval.requested")).toHaveLength(1);
    }
  });
});

describe("the walls: space, company, guest, and the owner's silent reading", () => {
  it("only the requester, the people named, the space's managers and the owner read it; the others get 404 on every route", async () => {
    const w = await approvalsWorld();
    const id = await ask(w, w.member, [w.lead.id], { amount: "250", currency: "USD" });
    for (const who of [w.member, w.lead, w.admin, w.owner]) {
      await loginAs(who.id);
      const res = await read(id);
      expect(res.status, who.name).toBe(200);
      expect(approvalOf(res)["amount"], who.name).toEqual({ minor: 25000, currency: "USD" });
    }
    // a person of the space who is neither the asker nor named, one who works only in another space, a person of another company
    for (const who of [w.member2, w.outsider, w.foreign.member, w.foreign.owner]) {
      await loginAs(who.id);
      expect((await read(id)).status, who.name).toBe(404);
      expect((await cancel(id)).status, who.name).toBe(404);
      expect((await resubmit(id, { title: "x" })).status, who.name).toBe(404);
      const mine = await list("?view=mine");
      expect(JSON.stringify(mine.json), who.name).not.toContain(id);
    }
    // the lists never leak either
    await loginAs(w.member2.id);
    for (const view of ["mine", "waiting"]) expect(((await list(`?view=${view}`)).json?.["approvals"] as unknown[]).length, view).toBe(0);
  });

  it("someone who leaves the space (or the company) stops reading it, even when they were named", async () => {
    const w = await approvalsWorld();
    const id = await ask(w, w.member, [w.lead.id]);
    await loginAs(w.lead.id);
    expect((await read(id)).status).toBe(200);
    await db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.lead.id } } });
    expect((await read(id)).status).toBe(404);
    expect((await decide(id, "APPROVE")).status).toBe(404);
    expect(((await list("?view=waiting")).json?.["approvals"] as unknown[]).length).toBe(0);
    expect((await row(id)).status).toBe("PENDING");
  });

  it("a guest gets 403 guest.no_access on EVERY route and never an amount, a title or a name — even one who was named before they became a guest", async () => {
    const w = await approvalsWorld();
    const id = await ask(w, w.member, [w.lead.id, w.member2.id], { title: "سر العنوان", details: "تفاصيل سرية", amount: "777", currency: "JOD" });
    // member2 was named, then the owner made them an external partner
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.orgId, userId: w.member2.id } }, data: { role: "GUEST" } });
    for (const guest of [w.guest, w.member2]) {
      await loginAs(guest.id);
      const results = [
        await list(),
        await list("?view=waiting"),
        await list("?view=all"),
        await read(id),
        await decide(id, "APPROVE"),
        await cancel(id),
        await resubmit(id, { title: "x" }),
        await create({ workspaceId: w.ws.id, title: "x", approverIds: [w.lead.id] }),
        await approvers(w.ws.id),
      ];
      for (const res of results) {
        expect(res.status, guest.name).toBe(403);
        expect(messageOf(res), guest.name).toBe("guest.no_access");
        for (const secret of ["سر العنوان", "تفاصيل سرية", "777", "JOD", "amount", id]) expect(res.text, `${guest.name} ${secret}`).not.toContain(secret);
      }
    }
    expect((await row(id)).status).toBe("PENDING");
  });

  it("the file of a request opens for the people who may read the request, and for nobody else", async () => {
    const w = await approvalsWorld();
    const file = await makeUpload(w.orgId, w.member.id);
    const id = await ask(w, w.member, [w.lead.id], { fileIds: [file.id] });
    const ctx = (u: { id: string }, orgRole: "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST") => ({ orgId: w.orgId, userId: u.id, orgRole });
    for (const [who, role] of [[w.member, "MEMBER"], [w.lead, "LEAD"], [w.admin, "ADMIN"], [w.owner, "OWNER"]] as const) {
      await expect(assertMayReadFile(ctx(who, role), file.id), who.name).resolves.toBeUndefined();
    }
    for (const [who, role] of [[w.member2, "MEMBER"], [w.outsider, "MEMBER"], [w.guest, "GUEST"]] as const) {
      await expect(assertMayReadFile(ctx(who, role), file.id), who.name).rejects.toMatchObject({ message: "files.not_found" });
    }
    // an upload older than a day that nobody claimed is purged — but not one a request holds
    const old = new Date(Date.now() - 3 * 86_400_000);
    const heldOld = await makeUpload(w.orgId, w.member.id, "قديم.pdf", old);
    const orphan = await makeUpload(w.orgId, w.member.id, "يتيم.pdf", old);
    const second = await ask(w, w.member, [w.lead.id], { fileIds: [heldOld.id] });
    await purgeOrphanUploads(w.orgId);
    expect(await db.storedFile.count({ where: { id: heldOld.id } })).toBe(1);
    expect(await db.storedFile.count({ where: { id: orphan.id } })).toBe(0);
    expect(await db.approvalAttachment.count({ where: { requestId: second } })).toBe(1);
  });

  it("the owner reads every request of his company silently: no row, no notification, no change; he decides only when he is named", async () => {
    const w = await approvalsWorld();
    // a request of a space the owner has no row in
    const id = await ask(w, w.member, [w.lead.id], { amount: "40", currency: "USD" });
    expect(await db.workspaceMember.count({ where: { userId: w.owner.id } })).toBe(0);
    const before = { audit: await db.auditLog.count(), bell: await db.notification.count(), steps: await db.approvalStep.findMany({ orderBy: { id: "asc" } }), req: await row(id) };
    await loginAs(w.owner.id);
    const one = await read(id);
    expect(one.status).toBe(200);
    expect(approvalOf(one)["you"]).toMatchObject({ canDecide: false, canCancel: false, canResubmit: false, oversight: true });
    expect(((await list("?view=all")).json?.["approvals"] as { id: string }[]).map((a) => a.id)).toContain(id);
    expect(await db.auditLog.count()).toBe(before.audit);
    expect(await db.notification.count()).toBe(before.bell);
    expect(await db.approvalStep.findMany({ orderBy: { id: "asc" } })).toEqual(before.steps);
    expect(await row(id)).toEqual(before.req);
    expect(await db.workspaceMember.count({ where: { userId: w.owner.id } })).toBe(0);
    // the oversight cannot decide, cancel or edit
    expect(messageOf(await decide(id, "APPROVE"))).toBe("approvals.e.not_approver");
    expect(messageOf(await cancel(id))).toBe("approvals.e.requester_only");
    expect((await row(id)).status).toBe("PENDING");
  });

  it("«كل الطلبات»: the owner reads the whole company, a space ADMIN only the spaces they manage, anybody else is refused", async () => {
    const w = await approvalsWorld();
    const inWs = await ask(w, w.member, [w.lead.id]);
    await loginAs(w.outsider.id);
    const inOther = await create({ workspaceId: w.other.id, title: "في مساحة أخرى", approverIds: [w.member.id] });
    expect(inOther.status).toBe(201);
    const otherId = approvalOf(inOther)["id"] as string;
    const allIds = async (who: { id: string }) => {
      await loginAs(who.id);
      return ((await list("?view=all")).json?.["approvals"] as { id: string }[]).map((a) => a.id).sort();
    };

    expect(await allIds(w.owner)).toEqual([inWs, otherId].sort());
    // the org admin is the ADMIN of `ws` and is not in `other`
    expect(await allIds(w.admin)).toEqual([inWs]);
    await loginAs(w.admin.id);
    expect((await read(otherId)).status).toBe(404);
    // a plain member of the other space has no «كل الطلبات» (403) until the space makes them its ADMIN; then it is that space only
    await loginAs(w.outsider.id);
    const denied = await list("?view=all");
    expect(denied.status).toBe(403);
    expect(messageOf(denied)).toBe("approvals.e.all_denied");
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: w.other.id, userId: w.outsider.id } }, data: { role: "ADMIN" } });
    expect(await allIds(w.outsider)).toEqual([otherId]);
    // a space ADMIN reads the requests of their space but is no approver unless named
    await loginAs(w.outsider.id);
    expect((await read(otherId)).status).toBe(200);
    // the member of both spaces asked in `other`: that request is on their «بانتظاري»; the one they asked in `ws` is on «طلباتي»
    await loginAs(w.member.id);
    expect(((await list("?view=waiting")).json?.["approvals"] as { id: string }[]).map((a) => a.id)).toEqual([otherId]);
    expect(((await list("?view=mine")).json?.["approvals"] as { id: string }[]).map((a) => a.id)).toEqual([inWs]);
    // a plain member of `ws` only (no manager row anywhere) is refused
    await loginAs(w.member2.id);
    expect((await list("?view=all")).status).toBe(403);
  });
});

describe("the lists", () => {
  it("«بانتظاري» holds exactly the requests whose turn is mine now; «طلباتي» what I asked; a status can narrow", async () => {
    const w = await approvalsWorld();
    const a = await ask(w, w.member, [w.lead.id, w.admin.id]);
    const b = await ask(w, w.member2, [w.admin.id]);
    const ids = async (as: { id: string }, view: string, extra = "") => {
      await loginAs(as.id);
      return ((await list(`?view=${view}${extra}`)).json?.["approvals"] as { id: string }[]).map((x) => x.id).sort();
    };
    expect(await ids(w.lead, "waiting")).toEqual([a]);
    expect(await ids(w.admin, "waiting")).toEqual([b]); // `a` is not the admin's turn yet
    await loginAs(w.lead.id);
    await decide(a, "APPROVE");
    expect(await ids(w.lead, "waiting")).toEqual([]);
    expect(await ids(w.admin, "waiting")).toEqual([a, b].sort());
    expect(await ids(w.member, "mine")).toEqual([a]);
    expect(await ids(w.member2, "mine")).toEqual([b]);
    await loginAs(w.admin.id);
    await decide(b, "REJECT", "لا");
    expect(await ids(w.member2, "mine", "&status=REJECTED")).toEqual([b]);
    expect(await ids(w.member2, "mine", "&status=PENDING")).toEqual([]);
    expect(await ids(w.admin, "waiting")).toEqual([a]);
    // the list item says who it waits on and carries the chain
    await loginAs(w.member.id);
    const item = ((await list("?view=mine")).json?.["approvals"] as { waitingOn: { name: string }; steps: unknown[] }[])[0]!;
    expect(item.waitingOn.name).toBe("Admin");
    expect(item.steps).toHaveLength(2);
    // a list is scoped to a space when asked
    expect(((await list(`?view=mine&workspaceId=${w.other.id}`)).json?.["approvals"] as unknown[]).length).toBe(0);
  });
});

describe("the bell and the phone: generic text, never the amount or the details", () => {
  it("every approval event reaches the bell in Arabic and the Web Push as a fixed generic line", async () => {
    const w = await approvalsWorld();
    for (const user of [w.lead, w.admin, w.member]) await db.pushSubscription.create({ data: { userId: user.id, endpoint: `https://push.test.local/${user.id}`, p256dh: "k", auth: "a" } });
    const id = await ask(w, w.member, [w.lead.id, w.admin.id], { title: "سر العنوان", details: "تفاصيل سرية", amount: "777.5", currency: "JOD" });
    await loginAs(w.lead.id);
    await decide(id, "APPROVE", "سبب سري");
    await loginAs(w.admin.id);
    await decide(id, "CHANGES", "تعديل سري");
    await loginAs(w.member.id);
    await resubmit(id, { title: "عنوان ثانٍ سري" });
    await flushPushesForTests();

    // create (1) + a step passed (2: the requester, the next approver) + sent back (2) + resubmitted (1)
    expect(sent).toHaveLength(6);
    for (const message of sent) {
      const wire = JSON.stringify(message);
      for (const secret of ["سر العنوان", "عنوان ثانٍ", "تفاصيل", "سبب سري", "تعديل سري", "777", "JOD", "دينار", "Member"]) expect(wire, secret).not.toContain(secret);
      expect(message.body).toBe("افتح التطبيق لمراجعة الطلب");
    }
    expect(new Set(sent.map((m) => m.title))).toEqual(
      new Set(["طلب موافقة بانتظارك", "وافق أحد المعتمدين على الطلب وانتقل إلى المعتمد التالي", "طُلب منك تعديل الطلب", "أُعيد الطلب إلى صاحبه للتعديل", "طلب موافقة معدَّل بانتظارك"]),
    );
    // inside the app the bell names the request and the person (still never the amount)
    const rows = await db.notification.findMany({ where: { userId: { in: [w.lead.id, w.admin.id, w.member.id] }, type: { startsWith: "approval_" } } });
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) {
      expect(r.linkUrl).toBe(`/approvals/${id}`);
      expect(r.workspaceId).toBe(w.ws.id);
      expect(r.organizationId).toBe(w.orgId);
      expect(`${r.title} ${r.body}`).not.toMatch(/777|JOD|دينار/);
    }
  });
});

describe("«الميزات»: the switch", () => {
  it("off, every route is 404 features.off for everybody (the owner included) and nothing is written; on again, everything is back", async () => {
    const w = await approvalsWorld();
    const id = await ask(w, w.member, [w.lead.id]);
    await loginAs(w.owner.id);
    expect((await flip("approvals", false)).status).toBe(200);
    const body = { workspaceId: w.ws.id, title: "x", approverIds: [w.lead.id] };
    for (const who of [w.owner, w.admin, w.member, w.lead]) {
      await loginAs(who.id);
      const results = [await list(), await read(id), await create(body), await decide(id, "APPROVE"), await cancel(id), await resubmit(id, {}), await approvers(w.ws.id)];
      for (const res of results) {
        expect(res.status, who.name).toBe(404);
        expect(messageOf(res), who.name).toBe("features.off");
      }
    }
    // a guest sees the switch first, too (nothing to say about a feature that does not exist)
    await loginAs(w.guest.id);
    expect((await list()).status).toBe(404);
    expect((await row(id)).status).toBe("PENDING");
    expect(await db.approvalRequest.count({ where: { orgId: w.orgId } })).toBe(1);
    // the file of a request does not open through the switched-off feature either
    const file = await makeUpload(w.orgId, w.member.id);
    await db.approvalAttachment.create({ data: { requestId: id, fileId: file.id, version: 1, addedById: w.member.id } });
    await expect(assertMayReadFile({ orgId: w.orgId, userId: w.lead.id, orgRole: "LEAD" }, file.id)).rejects.toMatchObject({ message: "files.not_found" });

    await loginAs(w.owner.id);
    expect((await flip("approvals", true)).status).toBe(200);
    await loginAs(w.lead.id);
    expect((await read(id)).status).toBe(200);
    expect((await decide(id, "APPROVE")).status).toBe(200);
  });
});
