import { describe, expect, it } from "vitest";
import { verifyPassword } from "@/server/auth";
import { transparencyVersionOf } from "@/server/policy/org-settings";
import { db, uid } from "./helpers";

// The seed's body, exported so it can run against the throw-away test database (importing the
// file does not run the seed: only executing it does).
const seedModule = () => import("../../prisma/seed");

describe("the demo seed", () => {
  it("creates an owner who is already onboarded and can sign in with a username", async () => {
    const { seedDemo } = await seedModule();
    const email = `seed-${uid()}@test.local`;
    const lines: string[] = [];
    await seedDemo(db, { SEED_OWNER_EMAIL: email, SEED_OWNER_PASSWORD: "Seed-owner-pass1" }, (l) => lines.push(l));

    const owner = await db.user.findUniqueOrThrow({
      where: { email },
      include: { memberships: { include: { organization: true } } },
    });
    expect(owner.username).toBe("owner");
    expect(owner.mustChangePassword).toBe(false);
    expect(owner.memberships).toHaveLength(1);
    const membership = owner.memberships[0]!;
    expect(membership).toMatchObject({ role: "OWNER", status: "ACTIVE" });
    expect(owner.transparencyVersion).toBe(transparencyVersionOf(membership.organization.settings));
    expect(owner.transparencyAcceptedAt).toBeInstanceOf(Date);
    expect(await verifyPassword("Seed-owner-pass1", owner.passwordHash)).toBe(true);
    // the owner is in the demo workspace
    const ws = await db.workspace.findFirstOrThrow({ where: { organizationId: membership.organizationId } });
    expect(await db.workspaceMember.count({ where: { workspaceId: ws.id, userId: owner.id } })).toBe(1);
    // a password given in the environment is never printed
    expect(lines.join("\n")).not.toContain("Seed-owner-pass1");
  });

  it("is safe to run again: nothing is duplicated and the password is left alone", async () => {
    const { seedDemo } = await seedModule();
    const email = `seed-${uid()}@test.local`;
    const quiet = () => {};
    await seedDemo(db, { SEED_OWNER_EMAIL: email, SEED_OWNER_PASSWORD: "Seed-owner-pass1" }, quiet);
    const first = await db.user.findUniqueOrThrow({ where: { email } });
    await seedDemo(db, { SEED_OWNER_EMAIL: email, SEED_OWNER_PASSWORD: "Other-owner-pass2" }, quiet);
    const again = await db.user.findUniqueOrThrow({ where: { email } });
    expect(again.passwordHash).toBe(first.passwordHash);
    expect(await db.organization.count({ where: { slug: "zaki-demo" } })).toBe(1);
    expect(await db.organizationMember.count({ where: { userId: first.id } })).toBe(1);
  });
});
