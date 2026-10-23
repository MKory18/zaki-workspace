import { db } from "@/server/db";
import {
  audit,
  ForbiddenError,
  hashPassword,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  verifyPassword,
} from "@/server/auth";
import { transparencyVersionOf } from "@/server/policy/org-settings";

/**
 * The one-time onboarding every account goes through (the owner creates accounts with a temporary
 * password and nobody has accepted the transparency notice yet):
 *  1. choose your own password  -> `changeOwnPassword`
 *  2. accept the notice         -> `acceptTransparency`
 * The routes that call these (POST /api/me/password, POST /api/me/transparency) re-issue the
 * session cookie afterwards with `startSession`.
 */

/** The person's working organization: their oldest ACTIVE membership (the rule of currentUser()). */
async function activeMembership(userId: string) {
  return db.organizationMember.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, organization: { select: { settings: true } } },
  });
}

/**
 * Changes the caller's own password. The current one must verify and the new one must differ
 * from it. Clears `mustChangePassword` and bumps `tokenVersion`, which ends EVERY session of this
 * person (another phone, a stolen cookie); the route signs the current browser in again with the
 * returned `tokenVersion` (the one this change wrote, not a later read).
 *
 * `user.tv` is the session version the request was authenticated with (`CurrentUser.tv`). The
 * write is conditional on that version AND on the hash that was verified: if the account changed
 * while the passwords were being checked (an owner's reset, "log out everywhere", another change)
 * nothing is written and the answer is 401 — the request no longer speaks for a valid session.
 */
export async function changeOwnPassword(
  user: { id: string; tv: number },
  currentPassword: string,
  newPassword: string,
): Promise<{ tokenVersion: number }> {
  const row = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!row) throw new NotFoundError("user.not_found");
  if (!(await verifyPassword(currentPassword, row.passwordHash))) throw new ForbiddenError("password.wrong_current");
  if (newPassword === currentPassword) {
    throw new ValidationError([{ path: "newPassword", message: "onboarding.err_same" }]);
  }
  const passwordHash = await hashPassword(newPassword);
  const { count } = await db.user.updateMany({
    where: { id: user.id, tokenVersion: user.tv, passwordHash: row.passwordHash },
    data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
  });
  if (count === 0) throw new UnauthorizedError("auth.required");
  const member = await activeMembership(user.id);
  await audit("auth.password_changed", { actorId: user.id, orgId: member?.organizationId ?? null, target: user.id });
  return { tokenVersion: user.tv + 1 };
}

/**
 * Records that the caller accepted the CURRENT version of their organization's transparency
 * notice ("work chats and files are kept and visible to the owner"), with the date. Accepting a
 * version already accepted changes nothing: the first date stays and no second record is written
 * (a double tap, or the onboarding page refreshing a stale cookie).
 */
export async function acceptTransparency(userId: string): Promise<{ version: number; recorded: boolean }> {
  const member = await activeMembership(userId);
  if (!member) throw new ForbiddenError("not_org_member");
  const version = transparencyVersionOf(member.organization.settings);
  // one conditional write: two taps at once cannot both record an acceptance
  const { count } = await db.user.updateMany({
    where: { id: userId, OR: [{ transparencyVersion: null }, { transparencyVersion: { lt: version } }] },
    data: { transparencyVersion: version, transparencyAcceptedAt: new Date() },
  });
  if (count === 0) return { version, recorded: false };
  await audit("auth.transparency_accepted", {
    actorId: userId,
    orgId: member.organizationId,
    target: userId,
    meta: { version },
  });
  return { version, recorded: true };
}
