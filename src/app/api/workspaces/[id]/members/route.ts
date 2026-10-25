import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, ForbiddenError, requireWorkspace, ValidationError, type OrgAccessContext } from "@/server/auth";
import { apiError, withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";
import {
  SpaceConflictError,
  canManageHere,
  changeWorkspaceMembers,
  listWorkspaceMembers,
  type MemberChanges,
} from "@/server/services/workspaces";
import { notifyMembership } from "@/server/notify";
import { goHref } from "@/lib/space-link";

/**
 * The people of a space: only those IN it whose membership is ACTIVE. The OWNER reads the list
 * without being on it. `canManage` tells the caller whether they may change it.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireWorkspace(params.id);
    const members = await listWorkspaceMembers(params.id, ctx.userId);
    return NextResponse.json({ members, canManage: await canManageHere(ctx, params.id) });
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

const roleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["ADMIN", "MEMBER"]),
});

/** The caller must manage this space: its ADMIN, the OWNER, or an org ADMIN who is in it. */
async function requireManager(workspaceId: string): Promise<OrgAccessContext> {
  const ctx = await requireWorkspace(workspaceId, ["ADMIN"]);
  if (!(await canManageHere(ctx, workspaceId))) throw new ForbiddenError("ws.admin_only");
  return ctx;
}

/** Applies the changes through the one service, then tells the people who were put in and writes the audit entry. */
async function apply(ctx: OrgAccessContext, workspaceId: string, changes: MemberChanges): Promise<NextResponse> {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, organizationId: true } });
  if (!ws) return apiError("not_found", "workspace.not_found");
  let added: string[];
  try {
    ({ added } = await changeWorkspaceMembers(ctx, workspaceId, changes));
  } catch (err) {
    if (err instanceof SpaceConflictError) return apiError("conflict", err.message);
    throw err;
  }
  if (added.length) {
    await notifyMembership({
      userIds: added,
      kind: "workspace",
      title: ws.name,
      linkUrl: goHref(workspaceId),
      actorId: ctx.userId,
      workspaceId: workspaceId,
    });
  }
  await audit("workspace.members_updated", {
    actorId: ctx.userId,
    orgId: ws.organizationId,
    target: workspaceId,
    meta: { name: ws.name },
  });
  return NextResponse.json({ ok: true });
}

/** POST: add / remove / promote / demote people. The OWNER, the space ADMIN, or an org ADMIN who is in the space. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireManager(params.id);
    const input = await parseJson(manageSchema, req);
    return apply(ctx, params.id, {
      add: input.addUserIds,
      remove: input.removeUserIds,
      promote: input.promoteUserIds,
      demote: input.demoteUserIds,
    });
  });
}

/** PATCH `{ userId, role }`: makes one person a space ADMIN or an ordinary MEMBER. Same rules as POST. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireManager(params.id);
    const input = await parseJson(roleSchema, req);
    return apply(ctx, params.id, input.role === "ADMIN" ? { promote: [input.userId] } : { demote: [input.userId] });
  });
}

/** DELETE `?userId=…`: takes one person out of the space. Same rules as POST. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireManager(params.id);
    const userId = new URL(req.url).searchParams.get("userId");
    if (!userId) throw new ValidationError([{ path: "userId", message: "required" }]);
    return apply(ctx, params.id, { remove: [userId] });
  });
}
