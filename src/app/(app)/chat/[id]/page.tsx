import { pageActor } from "@/app/(app)/_access";
import { ConversationPageClient } from "@/components/chat/conversation/conversation-page-client";

/** One conversation. Who may read it is decided again by the chat API (404 for anyone outside its audience). */
export default async function ChatConversationPage({ params }: { params: { id: string } }) {
  await pageActor();
  return <ConversationPageClient conversationId={params.id} />;
}

export const dynamic = "force-dynamic";
