import { describe, expect, it } from "vitest";
import { generateJoinCode, JOIN_CODE_ALPHABET } from "../src/server/services/orgs";
import { canTransition } from "../src/server/services/ideas";
import { registerSchema } from "../src/server/validation";

describe("generateJoinCode", () => {
  it("produces 8-char codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateJoinCode();
      expect(code).toHaveLength(8);
      for (const ch of code) {
        expect(JOIN_CODE_ALPHABET).toContain(ch);
      }
      // no lookalikes
      expect(code).not.toMatch(/[O0I1L]/);
    }
  });

  it("is effectively unique across calls", () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateJoinCode()));
    expect(codes.size).toBeGreaterThan(450);
  });
});

describe("canTransition (idea review discipline)", () => {
  it("NEW must be reviewed before anything else", () => {
    expect(canTransition("NEW", "UNDER_REVIEW")).toBe(true);
    expect(canTransition("NEW", "ACCEPTED")).toBe(false);
    expect(canTransition("NEW", "REJECTED")).toBe(false);
  });

  it("review decisions come from UNDER_REVIEW", () => {
    expect(canTransition("UNDER_REVIEW", "ACCEPTED")).toBe(true);
    expect(canTransition("UNDER_REVIEW", "REJECTED")).toBe(true);
    expect(canTransition("UNDER_REVIEW", "NEW")).toBe(false);
  });

  it("rejected ideas may return to review; accepted is terminal", () => {
    expect(canTransition("REJECTED", "UNDER_REVIEW")).toBe(true);
    expect(canTransition("ACCEPTED", "REJECTED")).toBe(false);
    expect(canTransition("ACCEPTED", "UNDER_REVIEW")).toBe(false);
  });

  it("rejects unknown statuses safely", () => {
    expect(canTransition("NOPE" as never, "ACCEPTED")).toBe(false);
  });
});

describe("registerSchema (create vs join)", () => {
  const base = { email: "a@b.co", name: "Ali", password: "pass1234" };

  it("create mode requires orgName", () => {
    const ok = registerSchema.safeParse({ ...base, orgName: "Z Org" });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data).toMatchObject({ mode: "create", orgName: "Z Org" });
    }
    const bad = registerSchema.safeParse(base);
    expect(bad.success).toBe(false);
  });

  it("join mode requires a joinCode and needs no orgName", () => {
    const ok = registerSchema.safeParse({ ...base, joinCode: "ABCD2345" });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data).toMatchObject({ mode: "join", joinCode: "ABCD2345" });
      expect((ok.data as { orgName?: string }).orgName).toBeUndefined();
    }
  });

  it("uppercases the join code", () => {
    const ok = registerSchema.safeParse({ ...base, joinCode: "abcd2345" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toMatchObject({ joinCode: "ABCD2345" });
  });

  it("carries an optional trimmed jobTitle (مسمى وظيفي)", () => {
    const ok = registerSchema.safeParse({ ...base, orgName: "O", jobTitle: "  مدير مشاريع " });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toMatchObject({ jobTitle: "مدير مشاريع" });
  });

  it("enforces password strength", () => {
    expect(registerSchema.safeParse({ ...base, orgName: "O", password: "short" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, orgName: "O", password: "nodigits_here" }).success).toBe(false);
  });
});
