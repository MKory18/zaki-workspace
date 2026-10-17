import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";

const readSchema = z
  .object({ id: z.string().min(1).optional(), ids: z.array(z.string().min(1)).max(100).optional(), all: z.boolean().optional() })
  .refine((v) => v.all === true || typeof v.id === "string" || v.ids?.length, "id_or_all_required");

/** Marks one, many, or all notifications read for the caller only. */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(readSchema, req);
    const user = await requireUser();
    const where = input.all === true
      ? { userId: user.id, readAt: null }
      : input.ids?.length
        ? { id: { in: input.ids }, userId: user.id }
        : { id: input.id!, userId: user.id };
    const result = await db.notification.updateMany({
      where,
      data: { readAt: new Date() },
    });
    return NextResponse.json({ updated: result.count });
  });
}
