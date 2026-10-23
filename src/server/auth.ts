import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "./db";
import { log } from "./log";
import { getSessionUser, clearSessionCookie, setSessionCookie } from "./session";
import type { OrgRole, WorkspaceRole } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { onboardingStateOf } from "./policy/org-settings";
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
  /** Optional: an account may have only a username. */
  email: string | null;
  username: string | null;
  name: string;
  locale: string;
  /** The password is a temporary one chosen by the owner: it must be changed first. */
  mustChangePassword: boolean;
  /** The transparency notice (work chats are archived and visible to the owner) is not accepted yet. */
  transparencyPending: boolean;
  /**
   * The session version this request was authenticated with (it equals the cookie's `tv` and was
   * equal to the database value when the request began). A route that re-issues the cookie signs
   * THIS value, never a fresh read: a revocation that lands while the request is in flight must
   * not be laundered into a brand-new cookie.
   */
  tv: number;
}

/**
 * The signed-in user, or null. Null means: no cookie, a cookie that is no longer honoured (the
 * user's session version moved on: suspended, offboarded, password reset, "log out everywhere"),
 * or no ACTIVE membership anywhere. Safe to call in server components.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  const session = await getSessionUser();
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      username: true,
      name: true,
      locale: true,
      tokenVersion: true,
      mustChangePassword: true,
      transparencyVersion: true,
      memberships: {
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { organization: { select: { settings: true } } },
      },
    },
  });
  if (!user || user.tokenVersion !== session.tv) return null;
  const active = user.memberships[0];
  if (!active) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    locale: user.locale,
    tv: user.tokenVersion,
    ...onboardingStateOf(user, active.organization.settings),
  };
}

/**
 * For server-rendered pages: the person looking at the page, or null when nobody is signed in
 * (the page decides, usually `redirect("/login")`). Somebody who still owes the onboarding
 * (temporary password, transparency notice) never gets a page: they are sent to /onboarding BEFORE
 * anything is read. The (app) layout redirects them too, but in the App Router a page runs (and
 * its output is streamed) even when its layout redirects, so every page must refuse for itself.
 */
export async function pageUser(): Promise<CurrentUser | null> {
  const user = await currentUser();
  if (user && (user.mustChangePassword || user.transparencyPending)) redirect("/onboarding");
  return user;
}

/**
 * The signed-in user or a 401. Until they have changed a temporary password and accepted the
 * transparency notice the answer is 403 `auth.onboarding_required`; only the few routes that
 * ARE the onboarding (change password, accept notice, who am I, sign out) pass `allowPending`.
 */
export async function requireUser(opts: { allowPending?: boolean } = {}): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) {
    throw new UnauthorizedError("auth.required");
  }
  if (!opts.allowPending && (user.mustChangePassword || user.transparencyPending)) {
    throw new ForbiddenError("auth.onboarding_required");
  }
  return user;
}

/**
 * Signs `userId` in: a cookie carrying a session version and whatever onboarding they still owe.
 * Used after login, password change and accepting the notice.
 *
 * `opts.tv` is the version to sign. A sign-in (nobody is authenticated yet) leaves it out and gets
 * the CURRENT version. A request that is already authenticated passes the version it was
 * authenticated with (`CurrentUser.tv`, or the new version a password change just wrote): if the
 * session was revoked in the meantime that cookie is simply already stale, instead of the
 * revocation being undone by a fresh read.
 */
export async function startSession(userId: string, opts: { tv?: number } = {}): Promise<void> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      tokenVersion: true,
      mustChangePassword: true,
      transparencyVersion: true,
      memberships: {
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { organization: { select: { settings: true } } },
      },
    },
  });
  const onboarding = onboardingStateOf(user, user.memberships[0]?.organization.settings ?? {});
  await setSessionCookie({
    userId,
    tv: opts.tv ?? user.tokenVersion,
    ...(onboarding.mustChangePassword ? { mcp: true } : {}),
    ...(onboarding.transparencyPending ? { tp: true } : {}),
  });
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
 * Verifies ACTIVE organization membership and returns the role. A suspended or offboarded member
 * is "not a member". GUESTs have read-only access by default; callers must check capabilities.
 */
export async function requireOrgMember(orgId: string): Promise<OrgAccessContext> {
  const user = await requireUser();
  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
    select: { role: true, status: true },
  });
  if (!member || member.status !== "ACTIVE") throw new ForbiddenError("not_org_member");
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

/**
 * A workspace (space) is visible to the people IN it, and to the organization OWNER, who sees
 * every one of them. Everybody else — an ADMIN included — needs a WorkspaceMember row, and an
 * ACTIVE organization membership to go with it (a removed employee's leftover row grants nothing).
 *
 * `roles` are the WORKSPACE roles allowed in. An org GUEST is a guest in every workspace whatever
 * their row says; an org ADMIN who is in a workspace outranks a lower row of their own.
 */
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
  const [orgMember, wsMember] = await Promise.all([
    db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: workspace.organizationId, userId: user.id } },
      select: { role: true, status: true },
    }),
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      select: { role: true },
    }),
  ]);
  if (!orgMember || orgMember.status !== "ACTIVE") throw new ForbiddenError("not_workspace_member");
  const ctx: OrgAccessContext = { orgId: workspace.organizationId, orgRole: orgMember.role, userId: user.id };
  if (orgMember.role === "OWNER") return ctx;
  if (!wsMember) throw new ForbiddenError("not_workspace_member");
  if (roles.includes(workspaceRoleOf(orgMember.role, wsMember.role))) return ctx;
  if (orgMember.role === "ADMIN" && roles.includes("ADMIN")) return ctx;
  throw new ForbiddenError("insufficient_role");
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
