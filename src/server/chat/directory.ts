import { db } from "@/server/db";
import type { DirectoryPersonDto } from "@/server/chat/dto";

/**
 * The people picker: ACTIVE non-guests of the company, the viewer excluded. It is the staff
 * directory, so its route keeps the `directory.view` capability and a guest is refused with
 * `chat.guest_forbidden` — a guest has no DMs and no new groups.
 */
export async function chatDirectory(orgId: string): Promise<DirectoryPersonDto[]> {
  const rows = await db.organizationMember.findMany({
    where: { organizationId: orgId, role: { not: "GUEST" }, status: "ACTIVE" },
    select: { userId: true, role: true, user: { select: { id: true, name: true, jobTitle: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    userId: r.userId,
    name: r.user.name,
    jobTitle: r.user.jobTitle,
    role: r.role,
  }));
}
