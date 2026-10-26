import { notFound } from "next/navigation";
import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { actorFeatureOn } from "@/server/services/features";
import { getServerT } from "@/lib/i18n/server";
import { GuestNotice, placeRefusedToGuest } from "@/app/(app)/_guest";
import { NotFoundError } from "@/server/auth";
import { db } from "@/server/db";
import { keepInSpace } from "@/server/services/current-space";
import { watchDetail } from "@/server/services/watch";
import { WatchRoom } from "@/components/watch/watch-room";

/** One «نتفرّج سوا» session, for the people it was started for (and the owner); anybody else: not found. */
export default async function WatchSessionPage({ params }: { params: { id: string } }) {
  const { user, actor } = await pageActor();
  if (placeRefusedToGuest(actor, "watch")) return <GuestNotice />;
  // switched off in «الميزات»: the feature is not there at all
  if (!(await actorFeatureOn(actor, "watch"))) notFound();
  // the «نتفرّج سوا» row of the person's grid
  if (!actorCan(actor, "watch.view")) return <SectionOffNotice />;
  // a session of another space of theirs: enter that space first, so the name at the top says where it is
  const where = await db.watchSession.findFirst({ where: { id: params.id, orgId: actor.orgId }, select: { spaceId: true } });
  if (!where) notFound();
  await keepInSpace(actor, where.spaceId, `/watch/${params.id}`);

  const ctx = { orgId: actor.orgId, orgRole: actor.role, userId: user.id };
  const session = await watchDetail(ctx, params.id).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  return <WatchRoom session={session} viewerId={user.id} />;
}

export const metadata = { title: getServerT().t("watch.title") };
export const dynamic = "force-dynamic";
