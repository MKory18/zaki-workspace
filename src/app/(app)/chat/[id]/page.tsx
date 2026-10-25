import { pageActor } from "@/app/(app)/_access";
import { ConversationPageClient } from "@/components/chat/conversation/conversation-page-client";
import { db } from "@/server/db";
import { keepInSpace } from "@/server/services/current-space";

/** One conversation. Who may read it is decided again by the chat API (404 for anyone outside its audience). */
export default async function ChatConversationPage({ params, searchParams = {} }: { params: { id: string }; searchParams?: { m?: string } }) {
  const { actor } = await pageActor();
  // a topic of another space of theirs: enter that space first (a DM belongs to no space and stays where it is)
  const topic = await db.conversation.findFirst({ where: { id: params.id, orgId: actor.orgId }, select: { spaceId: true } });
  if (topic?.spaceId) {
    const back = searchParams.m ? `/chat/${params.id}?m=${encodeURIComponent(searchParams.m)}` : `/chat/${params.id}`;
    await keepInSpace(actor, topic.spaceId, back);
  }
  return <ConversationPageClient conversationId={params.id} />;
}

export const dynamic = "force-dynamic";
