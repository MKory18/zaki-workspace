import { notFound } from "next/navigation";
import { pageActor, SectionOffNotice } from "@/app/(app)/_access";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { actorCan } from "@/server/policy/actor";
import { getPublicProfile } from "@/server/services/users";
import { ProfileCard } from "@/components/profile-card";

export default async function PublicProfilePage({ params }: { params: { id: string } }) {
  const { user: viewer, actor } = await pageActor();
  // a colleague's profile belongs to the staff directory: it needs `directory.view` (a person's own
  // profile is always theirs; a guest has no profile pages at all and falls through to "not found")
  if (!actor.isExternal && params.id !== viewer.id && !actorCan(actor, "directory.view")) {
    return <SectionOffNotice />;
  }

  let profile: Awaited<ReturnType<typeof getPublicProfile>> | null = null;
  try {
    profile = await getPublicProfile(viewer.id, params.id);
  } catch (err) {
    // "no such person / not yours to see" is a 404; anything else is a real fault and must not hide behind it
    if (!(err instanceof NotFoundError || err instanceof ForbiddenError)) throw err;
    profile = null;
  }
  if (!profile) notFound();

  return <ProfileCard profile={profile} mine={profile.id === viewer.id} />;
}

export const dynamic = "force-dynamic";
