import * as crypto from "node:crypto";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { assertSeedAllowed, resolveOwnerEmail, resolveOwnerPassword } from "./seed-guard";

/**
 * Seed: demo organization with owner + workspace + project + default board.
 * Safe to run repeatedly — idempotent by email/slug lookup.
 *
 * The repository is public, so no password is written here:
 *  - the owner gets a random password, printed ONCE when the account is created
 *    (or the one in SEED_OWNER_PASSWORD, which is never echoed);
 *  - it refuses to run when NODE_ENV=production, or when DATABASE_URL points at
 *    a host that is not this machine, unless ALLOW_PROD_SEED=1 (prisma/seed-guard.ts).
 */
async function main(): Promise<void> {
  assertSeedAllowed();

  const email = resolveOwnerEmail();
  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    const { password, generated } = resolveOwnerPassword();
    user = await db.user.create({
      data: {
        email,
        name: "Zaki Owner",
        passwordHash: await hashPassword(password),
      },
    });
    console.log("created user", user.email);
    console.log(
      generated
        ? `password (random, shown once, not stored anywhere): ${password}`
        : "password: the value of SEED_OWNER_PASSWORD",
    );
  } else {
    console.log("owner already exists - password left unchanged:", user.email);
  }

  let org = await db.organization.findUnique({ where: { slug: "zaki-demo" } });
  if (!org) {
    let joinCode = "";
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    for (let i = 0; i < 8; i += 1) {
      joinCode += alphabet[crypto.randomInt(alphabet.length)];
    }
    org = await db.organization.create({
      data: {
        name: "Zaki Demo Org",
        slug: "zaki-demo",
        keyPrefix: "ZD",
        joinCode,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    });
  }

  let ws = await db.workspace.findFirst({ where: { organizationId: org.id } });
  if (!ws) {
    ws = await db.workspace.create({
      data: {
        organizationId: org.id,
        name: "Main Workspace",
        slug: "main",
        members: { create: { userId: user.id, role: "ADMIN" } },
        projects: {
          create: {
            name: "First Project",
            description: "Seeded sample project",
            status: "ACTIVE",
            boards: {
              create: {
                name: "Main Board",
                columns: {
                  create: [
                    { name: "Backlog", color: "#6b7280", position: 0, done: false },
                    { name: "Todo", color: "#3b82f6", position: 1, done: false },
                    { name: "In Progress", color: "#f59e0b", position: 2, done: false },
                    { name: "In Review", color: "#a855f7", position: 3, done: false },
                    { name: "Done", color: "#10b981", position: 4, done: true },
                  ],
                },
              },
            },
            tasks: {},
          },
        },
      },
    });
  }

  await db.taskCounter.upsert({
    where: { organizationId: org.id },
    create: { organizationId: org.id, lastNumber: 0 },
    update: {},
  });

  console.log(`seeded org=${org.slug} workspace=${ws.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
