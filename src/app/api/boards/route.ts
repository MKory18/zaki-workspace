import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { requireWorkspace, audit, ForbiddenError, NotFoundError } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";

const createSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});

interface BoardInput {
  name: string;
  color: string;
  done: boolean;
}

const DEFAULT_COLUMNS: BoardInput[] = [
  { name: "Backlog", color: "#6b7280", done: false },
  { name: "Todo", color: "#3b82f6", done: false },
  { name: "In Progress", color: "#f59e0b", done: false },
  { name: "In Review", color: "#a855f7", done: false },
  { name: "Done", color: "#10b981", done: true },
];

/** Creates a board with the default workflow columns (customizable later). */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(createSchema, req);
    const project = await db.project.findFirst({
      where: { id: input.projectId },
      select: { id: true, workspaceId: true, workspace: { select: { organizationId: true } } },
    });
    if (!project) throw new NotFoundError("project.not_found");
    await requireWorkspace(project.workspaceId, ["ADMIN", "MEMBER"]);

    const board = await db.board.create({
      data: {
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? null,
        columns: {
          create: DEFAULT_COLUMNS.map((c, i) => ({ ...c, position: i })),
        },
      },
      select: { id: true, name: true, projectId: true },
    });
    await audit("board.created", { target: board.id, meta: { name: board.name } });
    return NextResponse.json({ board }, { status: 201 });
  });
}
