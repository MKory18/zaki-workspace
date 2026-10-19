import * as crypto from "node:crypto";
import { db } from "@/server/db";
import type { DbClient } from "@/server/db";
import { log } from "@/server/log";
import { audit, hashPassword } from "@/server/auth";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import type { OrgRole } from "@prisma/client";

export interface RegisterOrgInput {
  email: string;
  name: string;
  password: string;
  orgName: string;
}

export interface JoinOrgInput {
  email: string;
  name: string;
  password: string;
  joinCode: string;
  jobTitle?: string;
}

export interface ProfileFields {
  jobTitle?: string;
}

/**
 * Invitation join code: 8 chars from an unambiguous alphabet.
 * Regex-friendly and hard to confuse when read aloud (no 0/O, 1/I/L).
 */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateJoinCode(): string {
  let code = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i += 1) {
    code += JOIN_CODE_ALPHABET[bytes[i]! % JOIN_CODE_ALPHABET.length];
  }
  return code;
}

/** Creates user + organization (bootstrap). The registrant becomes OWNER. */
export async function registerOrganization(input: RegisterOrgInput & ProfileFields): Promise<{ userId: string }> {
  const email = input.email.toLowerCase().trim();
  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) throw new ForbiddenError("email.taken");

  const base = slugify(input.orgName) || "org";
  const slug = `${base}-${crypto.randomBytes(3).toString("hex")}`;
  const keyPrefix = await availablePrefix(db, base.slice(0, 4).toUpperCase() || "ZW");
  const joinCode = await uniqueJoinCode();

  try {
    const user = await db.user.create({
      data: {
        email,
        name: input.name,
        jobTitle: input.jobTitle ?? null,
        passwordHash: await hashPassword(input.password),
        memberships: {
          create: {
            role: "OWNER" satisfies OrgRole,
            organization: { create: { name: input.orgName, slug, keyPrefix, joinCode } },
          },
        },
      },
      select: { id: true },
    });

    // audit must never fail an already-committed registration (P2002 race → friendly error)
    try {
      await audit("user.registered", { actorId: user.id });
    } catch (err) {
      log.error("audit.write_failed", {
        action: "user.registered",
        actor: user.id,
        detail: err instanceof Error ? err.name : String(err).slice(0, 80),
      });
    }
    return { userId: user.id };
  } catch (err) {
    // concurrent duplicate email (race between the check above and the insert)
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002") {
      throw new ForbiddenError("email.taken");
    }
    throw err;
  }
}

/** Joins an existing organization via its invitation code → MEMBER role. */
export async function joinByCode(input: JoinOrgInput): Promise<{ userId: string; orgId: string }> {
  const email = input.email.toLowerCase().trim();
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new ForbiddenError("email.taken");

  const org = await db.organization.findUnique({
    where: { joinCode: input.joinCode.toUpperCase() },
    select: { id: true },
  });
  if (!org) throw new NotFoundError("joincode.invalid");

  try {
    const user = await db.user.create({
      data: {
        email,
        name: input.name,
        jobTitle: input.jobTitle ?? null,
        passwordHash: await hashPassword(input.password),
        memberships: {
          create: {
            role: "MEMBER" satisfies OrgRole,
            organizationId: org.id,
          },
        },
      },
      select: { id: true },
    });

    try {
      await audit("user.joined", { actorId: user.id, orgId: org.id });
    } catch (err) {
      log.error("audit.write_failed", {
        action: "user.joined",
        actor: user.id,
        detail: err instanceof Error ? err.name : String(err).slice(0, 80),
      });
    }
    return { userId: user.id, orgId: org.id };
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002") {
      throw new ForbiddenError("email.taken");
    }
    throw err;
  }
}

/** Generates a code that is not already taken (fits the unique index). */
async function uniqueJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateJoinCode();
    const clash = await db.organization.findUnique({
      where: { joinCode: code },
      select: { id: true },
    });
    if (!clash) return code;
  }
  throw new Error("joincode.exhausted");
}

/** OWNER/ADMIN rotate the invitation code; the old one stops working at once. */
export async function regenerateJoinCode(orgId: string, ctx: OrgAccessContext): Promise<string> {
  if (!canManageOrg(ctx.orgRole)) throw new ForbiddenError("insufficient_role");
  const code = await uniqueJoinCode();
  await db.organization.update({ where: { id: orgId }, data: { joinCode: code } });
  await audit("org.joincode.regenerated", { actorId: ctx.userId, orgId });
  return code;
}

/** Roles allowed to administer org-level settings. */
export function canManageOrg(role: OrgRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

async function availablePrefix(client: DbClient, base: string, attempt = 0): Promise<string> {
  const cand = `${base}${attempt === 0 ? "" : attempt}`.slice(0, 6);
  const row = await client.organization.findFirst({
    where: { keyPrefix: cand },
    select: { id: true },
  });
  if (row) return availablePrefix(client, base, attempt + 1);
  return cand;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}
