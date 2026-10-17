import { describe, expect, it } from "vitest";
import { TICKET_STATUSES, canTransition } from "@/server/services/tickets";

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
