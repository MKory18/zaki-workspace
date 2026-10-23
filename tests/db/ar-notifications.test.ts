import { describe, expect, it } from "vitest";
import { db, makeTeam } from "./helpers";
import { ctxOf } from "./active-helpers";
import { makeDepartment, makeMember, makeTicket, makeTicketComment } from "./guest-helpers";
import { addTicketComment, createTicket, updateTicket } from "@/server/services/tickets";
import { notifyAssignment, notifyComment } from "@/server/notify";
import { AR } from "@/lib/i18n/dict";
import { enumLabel } from "@/lib/i18n/enums";

/**
 * WP-ARABIC2 (a), the database half: what the bell is actually handed.
 *
 * The unit file `tests/wp-arabic2.test.ts` pins the source (no title is a `${prefix}-${number}`
 * template any more). This one proves the ROWS: the stored title is the Arabic phrase from the
 * dictionary, the machine label moves to the body, and a status change is named in Arabic.
 */

const arabicOnly = (s: string | null) => (s ?? "").replace(/0-9/g, "").replace(/[A-Za-z]/g, "") === (s ?? "");

describe("the notification rows the bell reads", () => {
  it("a task assignment stores «أُسندت إليك مهمة» and puts «ZK-12 · عنوان» in the body", async () => {
    const w = await makeTeam();
    await notifyAssignment({
      assigneeId: w.member.id,
      taskNumber: 12,
      orgPrefix: "ZK",
      taskId: "task-1",
      title: "جهّز تقرير الأسبوع",
    });
    const row = await db.notification.findFirst({ where: { userId: w.member.id, type: "task_assigned" } });
    expect(row?.title).toBe(AR["notif.type.task_assigned"]);
    expect(arabicOnly(row?.title ?? null)).toBe(true);
    expect(row?.body).toBe("ZK-12 · جهّز تقرير الأسبوع");
    expect(row?.linkUrl).toBe("/tasks/task-1");
  });

  it("a comment stores «تعليق جديد على مهمة» and the author line in the body", async () => {
    const w = await makeTeam();
    await notifyComment({
      taskId: "task-2",
      taskNumber: 7,
      orgPrefix: "ZK",
      authorId: w.owner.id,
      authorName: "سارة",
      body: "شفت الملاحظة، بمشي عليها",
      watcherIds: [w.member.id],
    });
    const row = await db.notification.findFirst({ where: { userId: w.member.id, type: "comment" } });
    expect(row?.title).toBe(AR["notif.type.comment"]);
    expect(row?.body).toContain("سارة");
    // the author is never notified of their own comment
    expect(await db.notification.count({ where: { userId: w.owner.id, type: "comment" } })).toBe(0);
  });

  it("a ticket assignment stores the Arabic phrase and «ZK-T1 · عنوان» in the body", async () => {
    const org = (await makeTeam()).org;
    const creator = await makeMember(org.id, "Creator");
    const assignee = await makeMember(org.id, "Assignee");
    const dept = await makeDepartment(org.id, { memberIds: [assignee.id] });
    const ticket = await createTicket(ctxOf(org.id, creator.id), dept.id, {
      title: "الطابعة واقفة",
      priority: "NORMAL",
      assigneeId: assignee.id,
    });
    const row = await db.notification.findFirst({ where: { userId: assignee.id, type: "ticket_assigned" } });
    expect(row?.title).toBe(AR["notif.type.ticket_assigned"]);
    expect(row?.body).toContain(`-T${ticket.number} · الطابعة واقفة`);
  });

  it("a ticket comment stores the Arabic phrase, with the ticket label in the body", async () => {
    const org = (await makeTeam()).org;
    const creator = await makeMember(org.id, "Creator");
    const assignee = await makeMember(org.id, "Assignee");
    const dept = await makeDepartment(org.id, { memberIds: [assignee.id] });
    const ticket = await makeTicket({ orgId: org.id, departmentId: dept.id, creatorId: creator.id, assigneeId: assignee.id });
    await addTicketComment(ctxOf(org.id, assignee.id), ticket.id, "خلصنا النص");
    const row = await db.notification.findFirst({ where: { userId: creator.id, type: "ticket_comment" } });
    expect(row?.title).toBe(AR["notif.type.ticket_comment"]);
    expect(row?.body).toMatch(/-T\d+ · /);
    expect(row?.body).toContain("خلصنا النص");
  });

  it("a status change names the new status in Arabic, never the enum", async () => {
    const org = (await makeTeam()).org;
    const creator = await makeMember(org.id, "Creator");
    const assignee = await makeMember(org.id, "Assignee");
    const dept = await makeDepartment(org.id, { memberIds: [assignee.id] });
    const ticket = await makeTicket({ orgId: org.id, departmentId: dept.id, creatorId: creator.id, assigneeId: assignee.id });
    // the assignee moves the ticket, so the CREATOR hears about it
    await updateTicket(ctxOf(org.id, assignee.id), ticket.id, { status: "IN_PROGRESS" });
    const row = await db.notification.findFirst({ where: { userId: creator.id, type: "ticket_status" } });
    expect(row?.title).toBe(AR["notif.type.ticket_status"]);
    expect(row?.body).not.toContain("IN_PROGRESS");
    expect(row?.body).toContain(enumLabel("TicketStatus", "IN_PROGRESS"));
    // and no row in the whole table carries a bare machine label as its title
    const rows = await db.notification.findMany({ select: { title: true } });
    for (const r of rows) expect(r.title).not.toMatch(/^ZK[-T]?\d/);
  });
});
