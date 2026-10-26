import { NextResponse } from "next/server";
import { assertMemberCan } from "@/server/policy/actor";
import { z } from "zod";
import { audit, NotFoundError, requireTeamWork } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6b7280"),
});

/** Adds a column at the end of the board workflow. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(createSchema, req);
    const board = await db.board.findFirst({
      where: { id: params.id },
      select: { id: true, project: { select: { workspaceId: true, teamId: true } } },
    });
    if (!board) throw new NotFoundError("board.not_found");
    const access = await requireTeamWork(board.project.workspaceId, board.project.teamId, ["ADMIN", "MEMBER"], "board.not_found");
    await assertMemberCan(access, "projects.edit", "section.edit_denied", { spaceGuestsPass: true });

    const last = await db.boardColumn.findFirst({
      where: { boardId: board.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const column = await db.boardColumn.create({
      data: {
        boardId: board.id,
        name: input.name,
        color: input.color,
        position: (last?.position ?? -1000) + 1000,
        done: false,
      },
      select: { id: true, name: true, color: true, position: true, done: true },
    });
    await audit("board.column_added", { target: column.id, meta: { boardId: board.id } });
    return NextResponse.json({ column }, { status: 201 });
  });
}
