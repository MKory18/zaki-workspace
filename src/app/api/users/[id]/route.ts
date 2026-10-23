import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { assertCan, requireActor } from "@/server/policy/actor";
import { getProfileForViewer } from "@/server/services/users";
import { avatarHue } from "@/lib/format";

/**
 * Another member's profile; visible only through a shared organization, and only to whoever holds
 * the `directory.view` capability (a person may always open their own entry).
 * An org GUEST holds no capability and keeps their restricted view: `{ id, name }` only, and only
 * for people who share a workspace with them (everybody else is 404).
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    if (!actor.isExternal && params.id !== actor.userId) assertCan(actor, "directory.view");
    const view = await getProfileForViewer(actor.userId, params.id);
    if (view.kind === "limited") return NextResponse.json({ profile: view.profile });
    const profile = view.profile;
    return NextResponse.json({ profile: { ...profile, hue: avatarHue(profile.name) } });
  });
}
