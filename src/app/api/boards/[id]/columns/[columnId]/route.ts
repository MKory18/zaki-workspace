import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, ForbiddenError, NotFoundError, requireWorkspace } from "@/server/auth";
import { apiError } from "@/server/api";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  done: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; columnId: string } },
) {
  return withApi(async () => {
    const input = await parseJson(patchSchema, req);
    const { board } = await resolveBoard(params.id);
    await requireWorkspace(board.project.workspaceId, ["ADMIN", "MEMBER"]);
    const column = await db.boardColumn.findFirst({
      where: { id: params.columnId, boardId: board.id },
      select: { id: true },
    });
    if (!column) throw new NotFoundError("column.not_found");
    const updated = await db.boardColumn.update({
      where: { id: column.id },
      data: input,
      select: { id: true, name: true, color: true, position: true, done: true },
    });
    await audit("board.column_updated", { target: column.id, meta: input });
    return NextResponse.json({ column: updated });
  });
}

/** Deletes an empty column; a board always keeps at least one. */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; columnId: string } },
) {
  return withApi(async () => {
    const { board } = await resolveBoard(params.id);
    await requireWorkspace(board.project.workspaceId, ["ADMIN", "MEMBER"]);
    const column = await db.boardColumn.findFirst({
      where: { id: params.columnId, boardId: board.id },
      select: { id: true, _count: { select: { tasks: true } } },
    });
    if (!column) throw new NotFoundError("column.not_found");
    const total = await db.boardColumn.count({ where: { boardId: board.id } });
    if (total <= 1) throw new ForbiddenError("column.last_one");
    if (column._count.tasks > 0) {
      return apiError("conflict", "column.not_empty");
    }
    await db.boardColumn.delete({ where: { id: column.id } });
    await audit("board.column_deleted", { target: column.id });
    return NextResponse.json({ ok: true });
  });
}

async function resolveBoard(boardId: string) {
  const board = await db.board.findFirst({
    where: { id: boardId },
    select: { id: true, project: { select: { workspaceId: true } } },
  });
  if (!board) throw new NotFoundError("board.not_found");
  return { board: board as typeof board & { id: string } };
}
