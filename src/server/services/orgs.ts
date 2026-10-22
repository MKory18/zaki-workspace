import * as crypto from "node:crypto";
import { db } from "@/server/db";
import type { DbClient } from "@/server/db";
import { log } from "@/server/log";
import { audit, hashPassword } from "@/server/auth";
import { ForbiddenError } from "@/server/auth";
import { DEFAULT_TRANSPARENCY_VERSION } from "@/server/policy/org-settings";
import type { OrgRole } from "@prisma/client";

export interface RegisterOrgInput {
  email: string;
  name: string;
  password: string;
  orgName: string;
}

export interface ProfileFields {
  jobTitle?: string;
}

/**
 * Legacy invitation code alphabet: 8 chars, no look-alikes (no 0/O, 1/I/L). Self-serve joining is
 * retired (accounts are created by the owner), but `Organization.joinCode` is still a required,
 * unique column, so a new organization still gets one. It is never honoured.
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

/**
 * Self-registration exists for the very first run only: while NO organization exists at all,
 * somebody may create the company and become its OWNER. After that, accounts are created by the
 * owner (and the people they allow) from inside the app.
 */
export async function registrationOpen(): Promise<boolean> {
  return (await db.organization.findFirst({ select: { id: true } })) === null;
}

/** Any constant: every first-run request takes the same transaction-scoped lock. */
const BOOTSTRAP_LOCK = 724_310_051;

/**
 * First run: creates the organization and its OWNER. The OWNER is created fully onboarded
 * (they chose this password themselves and they are the person the transparency notice protects).
 *
 * Race-safe: the "no organization yet" check and the creation run in one transaction holding an
 * advisory lock, so two simultaneous first-run requests cannot both create a company — the second
 * one waits, then finds the first company and is refused with `auth.registration_closed`.
 */
export async function registerOrganization(input: RegisterOrgInput & ProfileFields): Promise<{ userId: string }> {
  const email = input.email.toLowerCase().trim();
  // the slow part (bcrypt) happens before the lock is taken
  const passwordHash = await hashPassword(input.password);
  const base = slugify(input.orgName) || "org";
  const slug = `${base}-${crypto.randomBytes(3).toString("hex")}`;

  try {
    const user = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK}::bigint)`;
      if (await tx.organization.findFirst({ select: { id: true } })) throw new ForbiddenError("auth.registration_closed");
      if (await tx.user.findUnique({ where: { email }, select: { id: true } })) throw new ForbiddenError("email.taken");
      const keyPrefix = await availablePrefix(tx, base.slice(0, 4).toUpperCase() || "ZW");
      const joinCode = await uniqueJoinCode(tx);
      return tx.user.create({
        data: {
          email,
          name: input.name,
          jobTitle: input.jobTitle ?? null,
          passwordHash,
          mustChangePassword: false,
          transparencyVersion: DEFAULT_TRANSPARENCY_VERSION,
          transparencyAcceptedAt: new Date(),
          memberships: {
            create: {
              role: "OWNER" satisfies OrgRole,
              organization: { create: { name: input.orgName, slug, keyPrefix, joinCode } },
            },
          },
        },
        select: { id: true },
      });
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

/** Generates a code that is not already taken (fits the unique index). */
async function uniqueJoinCode(client: DbClient): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateJoinCode();
    const clash = await client.organization.findUnique({
      where: { joinCode: code },
      select: { id: true },
    });
    if (!clash) return code;
  }
  throw new Error("joincode.exhausted");
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
