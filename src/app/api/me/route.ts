import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson, profileSchema } from "@/server/validation";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { updateProfile } from "@/server/services/users";
import { avatarHue } from "@/lib/format";

/** Own profile (never includes passwordHash). */
export async function GET() {
  return withApi(async () => {
    const user = await requireUser();
    const me = await db.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        jobTitle: true,
        bio: true,
        locale: true,
        theme: true,
        createdAt: true,
      },
    });
    if (!me) {
      return NextResponse.json({ error: "auth.required" }, { status: 401 });
    }
    return NextResponse.json({ user: { ...me, hue: avatarHue(me.name) } });
  });
}

export async function PATCH(req: Request) {
  return withApi(async () => {
    const input = await parseJson(profileSchema, req);
    const user = await requireUser();
    await updateProfile(user.id, input);
    return NextResponse.json({ ok: true });
  });
}
