import * as crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { db as appDb } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { transparencyVersionOf } from "@/server/policy/org-settings";
import {
  DEFAULT_SEED_OWNER_USERNAME,
  assertSeedAllowed,
  resolveOwnerEmail,
  resolveOwnerPassword,
  type Env,
} from "./seed-guard";

/**
 * Seed: demo organization with owner + workspace + project + default board.
 * Safe to run repeatedly — idempotent by email/slug lookup.
 *
 * The owner is created already onboarded — they chose (or were shown) the password themselves and
 * nobody else accepts the transparency notice for them — and with the username "owner", so they
 * can sign in with it or with the e-mail.
 *
 * The repository is public, so no password is written here:
 *  - the owner gets a random password, printed ONCE when the account is created
 *    (or the one in SEED_OWNER_PASSWORD, which is never echoed);
 *  - it refuses to run when NODE_ENV=production, or when DATABASE_URL points at
 *    a host that is not this machine, unless ALLOW_PROD_SEED=1 (prisma/seed-guard.ts).
 */
async function main(): Promise<void> {
  assertSeedAllowed();
  await seedDemo(appDb);
}

/** The seed itself, exported so tests/db/seed-demo.test.ts can run it against the test database. */
export async function seedDemo(
  db: PrismaClient,
  env: Env = process.env,
  say: (line: string) => void = (line) => console.log(line),
): Promise<void> {
  const email = resolveOwnerEmail(env);
  let user = await db.user.findUnique({ where: { email } });

  let org = await db.organization.findUnique({ where: { slug: "zaki-demo" } });
  if (!org) {
    let joinCode = "";
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    for (let i = 0; i < 8; i += 1) {
      joinCode += alphabet[crypto.randomInt(alphabet.length)];
    }
    org = await db.organization.create({
      data: { name: "Zaki Demo Org", slug: "zaki-demo", keyPrefix: "ZD", joinCode },
    });
  }

  if (!user) {
    const { password, generated } = resolveOwnerPassword(env);
    const usernameTaken = await db.user.findUnique({ where: { username: DEFAULT_SEED_OWNER_USERNAME }, select: { id: true } });
    user = await db.user.create({
      data: {
        email,
        username: usernameTaken ? null : DEFAULT_SEED_OWNER_USERNAME,
        name: "Zaki Owner",
        passwordHash: await hashPassword(password),
        mustChangePassword: false,
        transparencyVersion: transparencyVersionOf(org.settings),
        transparencyAcceptedAt: new Date(),
      },
    });
    say(`created user ${user.email}${user.username ? ` (username: ${user.username})` : ""}`);
    say(
      generated
        ? `password (random, shown once, not stored anywhere): ${password}`
        : "password: the value of SEED_OWNER_PASSWORD",
    );
  } else {
    say(`owner already exists - password left unchanged: ${user.email}`);
  }

  await db.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    create: { organizationId: org.id, userId: user.id, role: "OWNER" },
    update: {},
  });

  let ws = await db.workspace.findFirst({ where: { organizationId: org.id } });
  if (!ws) {
    ws = await db.workspace.create({
      data: {
        organizationId: org.id,
        name: "Main Workspace",
        slug: "main",
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
  await db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: ws.id, userId: user.id } },
    create: { workspaceId: ws.id, userId: user.id, role: "ADMIN" },
    update: {},
  });

  await db.taskCounter.upsert({
    where: { organizationId: org.id },
    create: { organizationId: org.id, lastNumber: 0 },
    update: {},
  });

  say(`seeded org=${org.slug} workspace=${ws.name}`);
}

// Runs when executed (`npm run db:seed`, `prisma db seed`), not when a test imports seedDemo.
if (/(^|[\\/])prisma[\\/]seed\.ts$/.test(process.argv[1] ?? "")) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await appDb.$disconnect();
    });
}
