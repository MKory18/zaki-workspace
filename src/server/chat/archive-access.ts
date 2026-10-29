import { db } from "@/server/db";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { canArchive } from "@/server/policy/conversation";

/**
 * The owner's two eyes — the archive and the oversight list — are the capability `archive.view`: the rank must be
 * OWNER, and a partner (an OWNER who is not the primary owner) keeps it unless the primary owner took it away.
 * `canArchive(role)` answers the rank half; this answers the permission half from the member's row (never from the
 * cookie), through the same `effectiveCapabilities` every other capability uses. A revoked permission is gone.
 */
export async function holdsArchiveView(ctx: { orgId: string; userId: string }): Promise<boolean> {
  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: ctx.orgId, userId: ctx.userId } },
    select: {
      role: true,
      status: true,
      capabilities: true,
      revokedCapabilities: true,
      primaryOwner: true,
    },
  });
  if (!member || member.status !== "ACTIVE" || !canArchive(member.role)) return false;
  return effectiveCapabilities(member).has("archive.view");
}
