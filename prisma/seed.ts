import * as crypto from "node:crypto";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";

/**
 * Seed: demo organization with owner + workspace + project + default board.
 * Safe to run repeatedly — idempotent by email/slug lookup.
 */
async function main(): Promise<void> {
  const email = "owner@zaki.local";
  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    user = await db.user.create({
      data: {
        email,
        name: "Zaki Owner",
        passwordHash: await hashPassword("owner1234"),
      },
    });
    console.log("created user", user.email);
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
  console.log(`login: ${email} / owner1234 (dev only)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
