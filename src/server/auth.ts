import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { log } from "./log";
import { getSessionUser, clearSessionCookie, setSessionCookie } from "./session";
import type { OrgRole, WorkspaceRole } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { workspaceRoleOf } from "./workspace-role";

export { clearSessionCookie, setSessionCookie };

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  locale: string;
}

/** Returns the authenticated user or null. Safe to call in server components. */
export async function currentUser(): Promise<CurrentUser | null> {
  const session = await getSessionUser();
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, locale: true },
  });
  return user ?? null;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) {
    throw new UnauthorizedError("auth.required");
  }
  return user;
}

export class UnauthorizedError extends Error {
  constructor(msg = "auth.required") {
    super(msg);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(msg = "forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(msg = "not_found") {
    super(msg);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  readonly issues: { path: string; message: string }[];
  constructor(issues: { path: string; message: string }[]) {
    super("validation.failed");
    this.name = "ValidationError";
    this.issues = issues;
  }
}

// ---------- Guards ----------

export interface OrgAccessContext {
  orgId: string;
  orgRole: OrgRole;
  userId: string;
}

/**
 * Verifies organization membership and returns the role.
 * GUESTs have read-only access by default; callers must check capabilities.
 */
export async function requireOrgMember(orgId: string): Promise<OrgAccessContext> {
  const user = await requireUser();
  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
    select: { role: true },
  });
  if (!member) throw new ForbiddenError("not_org_member");
  return { orgId, orgRole: member.role, userId: user.id };
}

/** Throws unless the member holds one of the allowed roles. */
export async function requireOrgRole(
  orgId: string,
  roles: OrgRole[],
): Promise<OrgAccessContext> {
  const ctx = await requireOrgMember(orgId);
  if (!roles.includes(ctx.orgRole)) throw new ForbiddenError("insufficient_role");
  return ctx;
}

export async function requireWorkspace(
  workspaceId: string,
  roles: WorkspaceRole[] = ["ADMIN", "MEMBER", "GUEST"],
): Promise<OrgAccessContext> {
  const user = await requireUser();
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, organizationId: true },
  });
  if (!workspace) throw new NotFoundError("workspace.not_found");
  const [wsMember, orgMember] = await Promise.all([
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      select: { role: true },
    }),
    db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: workspace.organizationId, userId: user.id } },
      select: { role: true },
    }),
  ]);
  if (wsMember) {
    // An org GUEST is a guest in every workspace, whatever their workspace row says
    // (the row may say MEMBER or ADMIN: older data stored it that way).
    const effective = workspaceRoleOf(orgMember?.role, wsMember.role);
    if (roles.includes(effective)) {
      return { orgId: workspace.organizationId, orgRole: orgMember?.role ?? "GUEST", userId: user.id };
    }
    // Required higher role: org OWNER/ADMIN outrank any lower workspace row
    // (never GUEST — the org-level restriction still applies).
    const orgCanPromote = orgMember && (orgMember.role === "OWNER" || orgMember.role === "ADMIN") && roles.includes("ADMIN");
    if (orgCanPromote) {
      return { orgId: workspace.organizationId, orgRole: orgMember!.role, userId: user.id };
    }
    throw new ForbiddenError("insufficient_role");
  }
  // org-level ADMIN/OWNER inherit workspace access; GUEST does not inherit.
  if (orgMember && orgMember.role !== "GUEST") {
    return { orgId: workspace.organizationId, orgRole: orgMember.role, userId: user.id };
  }
  throw new ForbiddenError("not_workspace_member");
}

export async function audit(
  action: string,
  opts: {
    actorId?: string | null;
    orgId?: string | null;
    target?: string | null;
    meta?: Prisma.InputJsonValue;
  } = {},
): Promise<void> {
  log.info(action, { actor: opts.actorId, org: opts.orgId, target: opts.target });
  await db.auditLog.create({
    data: {
      action,
      actorId: opts.actorId ?? null,
      orgId: opts.orgId ?? null,
      target: opts.target ?? null,
      meta: opts.meta ?? Prisma.JsonNull,
    },
  });
}

/** Short stable id for logging correlation (no PII). */
export function correlationId(): string {
  return createHash("sha256").update(crypto.randomUUID()).digest("hex").slice(0, 12);
}
