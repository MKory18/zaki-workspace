import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, ForbiddenError, NotFoundError, requireWorkspace } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";
import { listWorkspaceMembers } from "@/server/services/workspaces";
import { canManageWorkspaceMembers } from "@/server/services/access";
import { notifyMembership } from "@/server/notify";

/** Assignable people for the caller's workspace. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ws = await db.workspace.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!ws) throw new NotFoundError("workspace.not_found");
    await requireWorkspace(ws.id);
    const members = await listWorkspaceMembers(ws.id);
    return NextResponse.json({ members });
  });
}

const manageSchema = z
  .object({
    addUserIds: z.array(z.string()).max(200).optional(),
    removeUserIds: z.array(z.string()).max(200).optional(),
    promoteUserIds: z.array(z.string()).max(200).optional(),
    demoteUserIds: z.array(z.string()).max(200).optional(),
  })
  .refine(
    (v) =>
      Boolean(
        v.addUserIds?.length ||
          v.removeUserIds?.length ||
          v.promoteUserIds?.length ||
          v.demoteUserIds?.length,
      ),
    { message: "ws.no_change" },
  );

/** POST: add / remove / promote / demote workspace members. Org OWNER/ADMIN or workspace ADMIN. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(manageSchema, req);
    const ws = await db.workspace.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true, name: true },
    });
    if (!ws) throw new NotFoundError("workspace.not_found");
    const ctx = await requireWorkspace(ws.id, ["ADMIN"]);
    if (!(await canManageWorkspaceMembers(ctx.userId, ws.id))) {
      throw new ForbiddenError("ws.admin_only");
    }
    await manage(ws.id, input);
    if (input.addUserIds?.length) {
      await notifyMembership({
        userIds: input.addUserIds,
        kind: "workspace",
        title: ws.name,
        linkUrl: "/projects",
        actorId: ctx.userId,
      });
    }
    await audit("workspace.members_updated", {
      actorId: ctx.userId,
      orgId: ws.organizationId,
      target: ws.id,
      meta: { name: ws.name },
    });
    return NextResponse.json({ ok: true });
  });
}

async function manage(
  workspaceId: string,
  input: z.infer<typeof manageSchema>,
) {
  const orgId = (
    await db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } })
  )?.organizationId;
  const orgRoles = new Map(
    (
      await db.organizationMember.findMany({
        where: { organizationId: orgId ?? "" },
        select: { userId: true, role: true },
      })
    ).map((m) => [m.userId, m.role] as const),
  );
  const isOrgGuest = (userId: string) => orgRoles.get(userId) === "GUEST";
  // An org GUEST (an external partner) is read-only everywhere: they are added as a workspace
  // GUEST, kept as one, and can never be promoted. Refused up front, so nothing else in the
  // same request is applied either.
  if ((input.promoteUserIds ?? []).some(isOrgGuest)) throw new ForbiddenError("guest.readonly");
  const add = (input.addUserIds ?? []).filter((id) => orgRoles.has(id));
  const demote = input.demoteUserIds ?? [];
  await db.$transaction(async (tx) => {
    for (const userId of add) {
      const guest = isOrgGuest(userId);
      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId, userId } },
        create: { workspaceId, userId, role: guest ? "GUEST" : "MEMBER" },
        // adding a guest again repairs a row that older data stored as MEMBER/ADMIN
        update: guest ? { role: "GUEST" } : {},
      });
    }
    if (input.promoteUserIds?.length) {
      await tx.workspaceMember.updateMany({
        where: { workspaceId, userId: { in: input.promoteUserIds }, role: "MEMBER" },
        data: { role: "ADMIN" },
      });
    }
    if (demote.length) {
      await tx.workspaceMember.updateMany({
        where: { workspaceId, userId: { in: demote.filter((id) => !isOrgGuest(id)) }, role: "ADMIN" },
        data: { role: "MEMBER" },
      });
      // a guest that older data stored as MEMBER/ADMIN lands on GUEST, not on MEMBER
      await tx.workspaceMember.updateMany({
        where: { workspaceId, userId: { in: demote.filter(isOrgGuest) }, role: { not: "GUEST" } },
        data: { role: "GUEST" },
      });
    }
    if (input.removeUserIds?.length) {
      await tx.workspaceMember.deleteMany({
        where: { workspaceId, userId: { in: input.removeUserIds } },
      });
    }
  });
}
