import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPABILITIES, OWNER_ONLY } from "@/server/policy/capabilities";
import { accountStatusSchema, createAccountSchema, updateAccountSchema } from "@/server/services/accounts";
import { USERNAME_MAX, USERNAME_MIN, passwordSchema, usernameSchema } from "@/server/services/credentials";
import { getServerT } from "@/lib/i18n/server";
import {
  EMPTY_ADD_FORM,
  JOB_TITLE_MAX,
  NAME_MAX,
  USERNAME_MAX as UI_USERNAME_MAX,
  USERNAME_MIN as UI_USERNAME_MIN,
  normalizeUsername,
  passwordProblem,
  validateAddForm,
  type AddFormValues,
} from "@/lib/members-ui";
import {
  createMember,
  offboardMember,
  reactivateMember,
  resetCapabilities,
  saveMemberInfo,
  setCapability,
  suspendMember,
} from "@/components/members/api";
import { LEAD, MEMBER, OWNER_ACTOR, SAMPLE, SUSPENDED, contractMember } from "./members-ui-fixtures";

/**
 * The screen and the account API agree. Every body the screen sends is parsed by the SERVER'S OWN
 * validators (accounts.ts, credentials.ts), and every limit the screen mirrors (it cannot import
 * credentials.ts: that file draws random numbers with node:crypto) is compared with the original.
 * If the API changes shape, this fails here and not in front of the owner.
 */

const { t } = getServerT();
const ORG = "org1";

/** Records the JSON body of every request the screen makes. */
function recordBodies(reply: () => { status?: number; json?: unknown } = () => ({ json: { ok: true } })): unknown[] {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
      const r = reply();
      return new Response(JSON.stringify(r.json ?? null), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
    }),
  );
  return bodies;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const form = (over: Partial<AddFormValues> = {}): AddFormValues => ({ ...EMPTY_ADD_FORM, name: "نور الهدى", username: "nour.huda", ...over });

describe("the limits the screen mirrors are the server's", () => {
  it("username length", () => {
    expect(UI_USERNAME_MIN).toBe(USERNAME_MIN);
    expect(UI_USERNAME_MAX).toBe(USERNAME_MAX);
  });

  it("a username is accepted by the screen exactly when the server accepts it", () => {
    const samples = [
      "ab",
      "abc",
      "a".repeat(32),
      "a".repeat(33),
      "9lives",
      "nour.huda",
      "nour_huda",
      "nour-huda",
      ".nour",
      "_nour",
      "-nour",
      "nour@huda",
      "nour huda", // spaces are removed by the screen as it is typed
      "NOUR",
      "نور",
      "nourنور",
      "a.b",
      "a..b",
      "",
      "   ",
    ];
    for (const username of samples) {
      const normalized = normalizeUsername(username);
      const server = usernameSchema.safeParse(normalized).success;
      const screen = validateAddForm(form({ username })) === null;
      expect(screen, JSON.stringify(username)).toBe(server);
    }
  });

  it("a typed password is accepted by the screen exactly when the server accepts it", () => {
    const samples = ["abcdefg1", "abcdefgh", "12345678", "short1", "Longenough1", "a".repeat(199) + "1", "a".repeat(200) + "1", "كلمةمرور123", "with space 1a", ""];
    for (const password of samples) {
      expect(passwordProblem(password) === null, JSON.stringify(password.slice(0, 20))).toBe(passwordSchema.safeParse(password).success);
    }
  });

  it("name and job-title lengths", () => {
    const base = { workspaceIds: [], role: "MEMBER" as const, username: "nour.huda" };
    for (const [name, ok] of [["ن", false], ["نو", true], ["ن".repeat(NAME_MAX), true], ["ن".repeat(NAME_MAX + 1), false]] as const) {
      expect(validateAddForm(form({ name })) === null, `ui ${name.length}`).toBe(ok);
      expect(createAccountSchema.safeParse({ ...base, name }).success, `server ${name.length}`).toBe(ok);
    }
    expect(createAccountSchema.safeParse({ ...base, name: "نور", jobTitle: "م".repeat(JOB_TITLE_MAX) }).success).toBe(true);
    expect(createAccountSchema.safeParse({ ...base, name: "نور", jobTitle: "م".repeat(JOB_TITLE_MAX + 1) }).success).toBe(false);
  });
});

describe("every body the screen sends passes the server's validators", () => {
  it("create: generated password, typed password, everything filled in, a guest", async () => {
    const bodies = recordBodies(() => ({ status: 201, json: { userId: "u", username: "x" } }));
    await createMember(ORG, form(), t);
    await createMember(ORG, form({ autoPassword: false, password: "Longenough1" }), t);
    await createMember(
      ORG,
      form({ email: "Nour@Example.Test", jobTitle: "محاسبة", role: "LEAD", managerId: "boss", workspaceIds: ["s1", "s2"] }),
      t,
    );
    await createMember(ORG, form({ role: "GUEST", managerId: "boss" }), t);
    expect(bodies).toHaveLength(4);
    for (const body of bodies) {
      const parsed = createAccountSchema.safeParse(body);
      expect(parsed.success, JSON.stringify(body)).toBe(true);
    }
    // the generated-password body carries no password, so the server generates one
    const generated = createAccountSchema.parse(bodies[0]);
    expect(generated.password).toBeUndefined();
    expect(generated.role).toBe("MEMBER");
    expect(createAccountSchema.parse(bodies[3]).managerId ?? null).toBeNull(); // a guest follows nobody
  });

  it("edit: every combination of name, job title, rank and manager", async () => {
    const bodies = recordBodies();
    const base = { name: LEAD.name, jobTitle: LEAD.jobTitle ?? "", role: LEAD.role, managerId: LEAD.managerId ?? "" };
    const edits = [
      { name: "منار الأحمد" },
      { jobTitle: "" }, // clear the title
      { jobTitle: "مسؤولة الشحن" },
      { role: "MEMBER" as const },
      { role: "GUEST" as const },
      { managerId: "" }, // clear the manager
      { managerId: "u-member" },
      { name: "منار الأحمد", jobTitle: "x", role: "MEMBER" as const, managerId: "u-member" },
    ];
    for (const edit of edits) await saveMemberInfo(ORG, LEAD, { ...base, ...edit }, SAMPLE.members, OWNER_ACTOR, t);
    expect(bodies).toHaveLength(edits.length);
    for (const body of bodies) {
      const parsed = updateAccountSchema.safeParse(body);
      expect(parsed.success, JSON.stringify(body)).toBe(true);
    }
    // clearing the title / manager really is a clear on the server side
    expect(updateAccountSchema.parse(bodies[1]).jobTitle).toBeNull();
    expect(updateAccountSchema.parse(bodies[5]).managerId).toBeNull();
  });

  it("capabilities: every switch, both ways, for every rank that can hold one, and the reset", async () => {
    const bodies = recordBodies();
    const switchable = CAPABILITIES.filter((c) => !OWNER_ONLY.includes(c));
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) {
      const person = contractMember({ id: "u-x", role, capabilities: ["cash.view"], revokedCapabilities: ["crm.edit"] });
      for (const capability of switchable) {
        await setCapability(ORG, person, capability, true, t);
        await setCapability(ORG, person, capability, false, t);
      }
      await resetCapabilities(ORG, person, OWNER_ACTOR, t);
    }
    expect(bodies).toHaveLength(3 * (switchable.length * 2 + 1));
    for (const body of bodies) {
      const parsed = updateAccountSchema.safeParse(body);
      expect(parsed.success, JSON.stringify(body)).toBe(true);
      if (parsed.success) {
        // never the same capability in both lists (accounts.cap_both_lists)
        const given = new Set(parsed.data.capabilities ?? []);
        for (const c of parsed.data.revokedCapabilities ?? []) expect(given.has(c), `${c} in both lists`).toBe(false);
      }
    }
  });

  it("a person with a name nobody knows in a stored list can still have a switch flipped (the name is not sent back)", async () => {
    const bodies = recordBodies();
    const person = contractMember({ id: "u-x", role: "MEMBER", capabilities: ["legacy.thing"], revokedCapabilities: ["old.thing"] });
    await setCapability(ORG, person, "prices.view", true, t);
    expect(updateAccountSchema.safeParse(bodies[0]).success).toBe(true);
    expect(JSON.stringify(bodies[0])).not.toContain("thing");
  });

  it("status: suspend, reactivate, offboard with and without a receiver", async () => {
    const bodies = recordBodies();
    await suspendMember(ORG, MEMBER, t);
    await reactivateMember(ORG, SUSPENDED, t);
    await offboardMember(ORG, SUSPENDED, "u-lead", t);
    await offboardMember(ORG, MEMBER, null, t);
    expect(bodies).toHaveLength(4);
    for (const body of bodies) {
      const parsed = accountStatusSchema.safeParse(body);
      expect(parsed.success, JSON.stringify(body)).toBe(true);
    }
    expect(accountStatusSchema.parse(bodies[2]).transferToUserId).toBe("u-lead");
    expect(accountStatusSchema.parse(bodies[3]).transferToUserId ?? null).toBeNull();
  });
});
