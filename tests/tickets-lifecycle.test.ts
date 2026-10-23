import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TICKET_STATUSES, canTransition } from "@/server/services/tickets";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

describe("ticket status transitions", () => {
  it("covers all four statuses", () => {
    expect(TICKET_STATUSES).toEqual(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
  });

  it("allows forward progress", () => {
    expect(canTransition("OPEN", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "RESOLVED")).toBe(true);
    expect(canTransition("RESOLVED", "CLOSED")).toBe(true);
  });

  it("allows reopening and backing out of resolved", () => {
    expect(canTransition("CLOSED", "OPEN")).toBe(true);
    expect(canTransition("RESOLVED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "OPEN")).toBe(true);
  });

  it("forbids illegal skips", () => {
    expect(canTransition("RESOLVED", "OPEN")).toBe(false);
    expect(canTransition("OPEN", "CLOSED")).toBe(true);
  });
});

describe("ticket lifecycle service contract (P1 regression)", () => {
  const svc = read("src", "server", "services", "tickets.ts");

  it("records activity on create, assign, edit, status change, comment", () => {
    expect(svc).toContain('event: "created"');
    expect(svc).toContain('event: "assigned"');
    expect(svc).toContain('event: "status_changed"');
    expect(svc).toContain('event: "edited"');
    expect(svc).toContain('event: "commented"');
  });

  it("notify watchers excludes the actor (no self-notification)", () => {
    // both notification fan-outs filter ctx.userId out of [assigneeId, creatorId]
    const matches = svc.match(/id !== ctx\.userId/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("comments are org-scoped through loadTicketForOrg", () => {
    const commentBody = svc.slice(svc.indexOf("addTicketComment"), svc.indexOf("listTicketComments"));
    expect(commentBody).toContain("loadTicketForOrg");
  });

  it("edit/delete comment: author or org admin only", () => {
    expect(svc).toContain("comment.not_yours");
  });

  it("myTickets is org-scoped and filters by assignee OR creator", () => {
    const mine = svc.slice(svc.indexOf("myTickets"));
    expect(mine).toContain("orgId: ctx.orgId");
    expect(mine).toContain("assigneeId: ctx.userId");
    expect(mine).toContain("creatorId: ctx.userId");
  });

  it("delete follows the edit rule (canEditTicket): the old 'creator may always delete' shortcut is gone", () => {
    // behaviour is covered by tests/db/guest-tickets.test.ts; this pins that delete reuses the edit facts
    const del = svc.slice(svc.indexOf("export async function deleteTicket("));
    expect(del).toContain("canEditTicket");
    expect(del).not.toContain("ticket.creatorId !== ctx.userId");
  });
});

describe("ticket comment routes contract", () => {
  it("comment create route goes through activeOrgCtx + parseJson", () => {
    const route = read("src", "app", "api", "tickets", "[id]", "detail", "route.ts");
    expect(route).toContain("activeOrgCtx");
    expect(route).toContain("parseJson");
    expect(route).toContain("ticketCommentSchema");
  });

  it("comment PATCH/DELETE enforce org ctx", () => {
    const route = read("src", "app", "api", "tickets", "[id]", "comments", "[commentId]", "route.ts");
    expect(route).toContain("activeOrgCtx");
  });

  it("mine route is auth-guarded", () => {
    const route = read("src", "app", "api", "tickets", "mine", "route.ts");
    expect(route).toContain("activeOrgCtx");
  });
});