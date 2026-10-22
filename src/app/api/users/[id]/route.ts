import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireUser } from "@/server/auth";
import { getProfileForViewer } from "@/server/services/users";
import { avatarHue } from "@/lib/format";

/**
 * Another member's profile; visible only through a shared organization.
 * An org GUEST gets `{ id, name }` only, and only for people who share a
 * workspace with them (everybody else is 404).
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const user = await requireUser();
    const view = await getProfileForViewer(user.id, params.id);
    if (view.kind === "limited") return NextResponse.json({ profile: view.profile });
    const profile = view.profile;
    return NextResponse.json({ profile: { ...profile, hue: avatarHue(profile.name) } });
  });
}
