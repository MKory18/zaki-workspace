import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getPublicProfile } from "@/server/services/users";
import { avatarHue } from "@/lib/format";

/** Another member's profile; visible only through a shared organization. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const user = await requireUser();
    const profile = await getPublicProfile(user.id, params.id);
    return NextResponse.json({ profile: { ...profile, hue: avatarHue(profile.name) } });
  });
}
