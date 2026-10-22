import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import {
  createDm,
  createDmSchema,
  createGroup,
  createGroupSchema,
  listConversations,
} from "@/server/services/chat";

const bodySchema = z.discriminatedUnion("kind", [createDmSchema, createGroupSchema]);

/** GET: my conversations (+ unread counts + last message preview). Guests get 403 (service). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json({ conversations: await listConversations(ctx) });
  });
}

/** POST: open a DM with one member or create a group. */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(bodySchema, req);
    const ctx = await activeOrgCtx();
    const id = input.kind === "DM" ? await createDm(ctx, input.userId) : await createGroup(ctx, input);
    return NextResponse.json({ id }, { status: 201 });
  });
}
