import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { CallRoom } from "@/components/calls/call-room";
import { db } from "@/server/db";
import { keepInSpace } from "@/server/services/current-space";

/** One call (a conversation's, or a meeting opened by its link). Who may join is decided again by the calls API. */
export default async function CallPage({ params }: { params: { id: string } }) {
  const { actor } = await pageActor();
  // a call of another space of theirs: enter that space first, so the name at the top says where the call is
  const call = await db.call.findFirst({ where: { id: params.id, orgId: actor.orgId }, select: { spaceId: true } });
  if (!call) notFound();
  if (call.spaceId) await keepInSpace(actor, call.spaceId, `/calls/${params.id}`);
  return <CallRoom callId={params.id} />;
}

export const dynamic = "force-dynamic";
