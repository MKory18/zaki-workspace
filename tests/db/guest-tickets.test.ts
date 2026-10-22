import { describe, expect, it } from "vitest";
import * as departmentTicketsRoute from "@/app/api/departments/[id]/tickets/route";
import * as ticketRoute from "@/app/api/tickets/[id]/route";
import * as detailRoute from "@/app/api/tickets/[id]/detail/route";
import * as commentRoute from "@/app/api/tickets/[id]/comments/[commentId]/route";
import * as mineRoute from "@/app/api/tickets/mine/route";
import { call, db, loginAs, makeTeam } from "./helpers";
import { makeDepartment, makeMember, makeTicket, makeTicketComment } from "./guest-helpers";

/**
 * One org, one department.
 *  - deptMember: has a DepartmentMember row
 *  - lead:       is Department.leadId only (no membership row)
 *  - assignee:   assigned to the tickets but NOT in the department
 *  - creator:    opened the tickets, NOT in the department
 *  - stranger:   unrelated MEMBER (not creator, not assignee, not in the department)
 */
async function ticketWorld() {
  const team = await makeTeam();
  const creator = await makeMember(team.org.id, "Creator");
  const assignee = await makeMember(team.org.id, "Assignee");
  const deptMember = await makeMember(team.org.id, "Dept member");
  const lead = await makeMember(team.org.id, "Dept lead");
  const stranger = await makeMember(team.org.id, "Stranger");
  const dept = await makeDepartment(team.org.id, { memberIds: [deptMember.id], leadId: lead.id });
  const openTicket = (over: { status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED"; creatorId?: string; assigneeId?: string | null } = {}) =>
    makeTicket({
      orgId: team.org.id,
      departmentId: dept.id,
      creatorId: over.creatorId ?? creator.id,
      assigneeId: over.assigneeId === undefined ? assignee.id : over.assigneeId,
      ...(over.status ? { status: over.status } : {}),
    });
  return { ...team, creator, assignee, deptMember, lead, stranger, dept, openTicket };
}

const patch = (id: string, body: Record<string, unknown>) =>
  call(ticketRoute.PATCH, { method: "PATCH", params: { id }, body });

describe("tickets: a GUEST is read-only", () => {
  it("cannot open a ticket, while a normal member still can", async () => {
    const w = await ticketWorld();
    await loginAs(w.guest.id);
    const res = await call(departmentTicketsRoute.POST, {
      params: { id: w.dept.id },
      body: { title: "Guest ticket", priority: "NORMAL" },
    });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("guest.readonly");
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(0);

    await loginAs(w.stranger.id);
    const ok = await call(departmentTicketsRoute.POST, {
      params: { id: w.dept.id },
      body: { title: "Member ticket", priority: "NORMAL" },
    });
    expect(ok.status).toBe(201);
  });

  it("cannot edit, change the status of, or delete a ticket - even as its creator, assignee or a department member", async () => {
    const w = await ticketWorld();
    await db.departmentMember.create({ data: { departmentId: w.dept.id, userId: w.guest.id } });
    const asCreator = await w.openTicket({ creatorId: w.guest.id });
    const asAssignee = await w.openTicket({ assigneeId: w.guest.id });
    const asDeptMember = await w.openTicket();

    await loginAs(w.guest.id);
    for (const ticket of [asCreator, asAssignee, asDeptMember]) {
      const edit = await patch(ticket.id, { title: "Changed by the guest" });
      expect(edit.status).toBe(403);
      expect(edit.json?.["message"]).toBe("guest.readonly");
      expect((await patch(ticket.id, { status: "CLOSED" })).status).toBe(403);
      expect((await call(ticketRoute.DELETE, { method: "DELETE", params: { id: ticket.id } })).status).toBe(403);

      const row = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(row.title).toBe(ticket.title);
      expect(row.status).toBe("OPEN");
    }
  });

  it("cannot comment, nor edit or delete a comment it wrote earlier", async () => {
    const w = await ticketWorld();
    const ticket = await w.openTicket();
    const oldComment = await makeTicketComment(ticket.id, w.guest.id, "written before the downgrade");

    await loginAs(w.guest.id);
    const add = await call(detailRoute.POST, { params: { id: ticket.id }, body: { body: "hello from the guest" } });
    expect(add.status).toBe(403);
    expect(add.json?.["message"]).toBe("guest.readonly");

    const edit = await call(commentRoute.PATCH, {
      method: "PATCH",
      params: { id: ticket.id, commentId: oldComment.id },
      body: { body: "rewritten" },
    });
    expect(edit.status).toBe(403);
    const del = await call(commentRoute.DELETE, {
      method: "DELETE",
      params: { id: ticket.id, commentId: oldComment.id },
    });
    expect(del.status).toBe(403);

    const comments = await db.ticketComment.findMany({ where: { ticketId: ticket.id } });
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe("written before the downgrade");
  });

  it("can still read tickets", async () => {
    const w = await ticketWorld();
    const ticket = await w.openTicket();
    await loginAs(w.guest.id);
    expect((await call(departmentTicketsRoute.GET, { params: { id: w.dept.id } })).status).toBe(200);
    expect((await call(detailRoute.GET, { params: { id: ticket.id } })).status).toBe(200);
    expect((await call(mineRoute.GET)).status).toBe(200);
  });
});

describe("tickets: who may edit or close a ticket", () => {
  it("an unrelated MEMBER cannot edit, re-prioritise or close someone else's OPEN ticket", async () => {
    const w = await ticketWorld();
    const ticket = await w.openTicket();
    await loginAs(w.stranger.id);

    for (const body of [{ title: "Hijacked" }, { priority: "URGENT" }, { status: "CLOSED" }, { status: "IN_PROGRESS" }]) {
      const res = await patch(ticket.id, body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.json?.["message"]).toBe("ticket.admin_only");
    }
    expect((await call(ticketRoute.DELETE, { method: "DELETE", params: { id: ticket.id } })).status).toBe(403);

    const row = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(row.title).toBe(ticket.title);
    expect(row.status).toBe("OPEN");
    expect(row.priority).toBe("NORMAL");
    expect(await db.ticketActivity.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  const allowed = [
    ["the creator", (w: Awaited<ReturnType<typeof ticketWorld>>) => w.creator],
    ["the assignee", (w: Awaited<ReturnType<typeof ticketWorld>>) => w.assignee],
    ["a department member", (w: Awaited<ReturnType<typeof ticketWorld>>) => w.deptMember],
    ["the department lead", (w: Awaited<ReturnType<typeof ticketWorld>>) => w.lead],
    ["an ADMIN", (w: Awaited<ReturnType<typeof ticketWorld>>) => w.admin],
    ["the OWNER", (w: Awaited<ReturnType<typeof ticketWorld>>) => w.owner],
  ] as const;

  for (const [label, pick] of allowed) {
    it(`${label} can edit and close an OPEN ticket`, async () => {
      const w = await ticketWorld();
      const ticket = await w.openTicket();
      await loginAs(pick(w).id);

      const edit = await patch(ticket.id, { title: "Edited by someone who may" });
      expect(edit.status).toBe(200);
      expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).title).toBe("Edited by someone who may");

      const close = await patch(ticket.id, { status: "CLOSED" });
      expect(close.status).toBe(200);
      expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("CLOSED");
    });
  }

  it("the old limit stays: a creator outside the department cannot touch the ticket once it is being worked on", async () => {
    const w = await ticketWorld();
    const ticket = await w.openTicket({ status: "IN_PROGRESS" });
    await loginAs(w.creator.id);
    const res = await patch(ticket.id, { title: "Too late" });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("ticket.admin_only");
  });

  it("the department lead (who has no membership row) can edit a ticket at any status", async () => {
    const w = await ticketWorld();
    for (const status of ["IN_PROGRESS", "RESOLVED", "CLOSED"] as const) {
      const ticket = await w.openTicket({ status });
      await loginAs(w.lead.id);
      const res = await patch(ticket.id, { priority: "HIGH" });
      expect(res.status, status).toBe(200);
      expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).priority).toBe("HIGH");
    }
  });

  it("the assignee can work a ticket through its lifecycle even when outside the department", async () => {
    const w = await ticketWorld();
    const ticket = await w.openTicket({ status: "IN_PROGRESS" });
    await loginAs(w.assignee.id);
    expect((await patch(ticket.id, { status: "RESOLVED" })).status).toBe(200);
    expect((await patch(ticket.id, { status: "CLOSED" })).status).toBe(200);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("CLOSED");
  });

  it("status transition rules still apply to people who may edit", async () => {
    const w = await ticketWorld();
    const resolved = await w.openTicket({ status: "RESOLVED" });
    await loginAs(w.admin.id);
    const bad = await patch(resolved.id, { status: "OPEN" });
    expect(bad.status).toBe(403);
    expect(bad.json?.["message"]).toBe("ticket.bad_transition");
    expect((await db.ticket.findUniqueOrThrow({ where: { id: resolved.id } })).status).toBe("RESOLVED");

    const closed = await w.openTicket({ status: "CLOSED" });
    const alsoBad = await patch(closed.id, { status: "IN_PROGRESS" });
    expect(alsoBad.json?.["message"]).toBe("ticket.bad_transition");
  });

  it("status changes still notify the other side and never the actor", async () => {
    const w = await ticketWorld();
    const ticket = await w.openTicket();

    await loginAs(w.assignee.id);
    expect((await patch(ticket.id, { status: "IN_PROGRESS" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: w.creator.id, type: "ticket_status" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: w.assignee.id, type: "ticket_status" } })).toBe(0);

    await loginAs(w.deptMember.id);
    expect((await patch(ticket.id, { status: "RESOLVED" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: w.creator.id, type: "ticket_status" } })).toBe(2);
    expect(await db.notification.count({ where: { userId: w.assignee.id, type: "ticket_status" } })).toBe(1);
  });

  it("assigning still notifies the new assignee and records the activity", async () => {
    const w = await ticketWorld();
    const ticket = await w.openTicket({ assigneeId: null });
    await loginAs(w.admin.id);
    const res = await patch(ticket.id, { assigneeId: w.deptMember.id });
    expect(res.status).toBe(200);
    expect(await db.notification.count({ where: { userId: w.deptMember.id, type: "ticket_assigned" } })).toBe(1);
    expect(await db.ticketActivity.count({ where: { ticketId: ticket.id, event: "assigned" } })).toBe(1);
  });

  it("any non-guest org member can still comment, and the assignee hears about it", async () => {
    const w = await ticketWorld();
    const ticket = await w.openTicket();
    await loginAs(w.stranger.id);
    const res = await call(detailRoute.POST, { params: { id: ticket.id }, body: { body: "me too" } });
    expect(res.status).toBe(201);
    expect(await db.notification.count({ where: { userId: w.assignee.id, type: "ticket_comment" } })).toBe(1);
  });
});
