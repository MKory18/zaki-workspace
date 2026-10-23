import { NextResponse } from "next/server";
import { ValidationError } from "@/server/auth";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { readArchive, archiveQuerySchema } from "@/server/chat/archive";
import type { ArchiveType } from "@/server/chat/dto";

/**
 * GET: the owner-only archive. The service supports type, person, space, date range, cursor and limit filters.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const url = new URL(req.url);
    const typeParam = url.searchParams.get("type");
    const type =
      typeParam && (archiveQuerySchema.type as readonly string[]).includes(typeParam)
        ? (typeParam as ArchiveType)
        : undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Math.min(Math.max(Number(limitRaw) || 0, 1), 100) : undefined;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;
    const validDate = (value: string | undefined) => !value || (datePattern.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value);
    if (!validDate(from) || !validDate(to) || (from && to && from > to)) {
      throw new ValidationError([{ path: "date", message: "chat.e.bad_date_range" }]);
    }
    const page = await readArchive(ctx, {
      type,
      personId: url.searchParams.get("personId") ?? undefined,
      spaceId: url.searchParams.get("spaceId") ?? undefined,
      from,
      to,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit,
    });
    return NextResponse.json(page);
  });
}
