import { pageActor } from "@/app/(app)/_access";
import { ChatHomeClient } from "@/components/chat/home/chat-home-client";

/** The chat list is scoped again by the server API for this authenticated actor. */
export default async function ChatPage() {
  const { actor } = await pageActor();
  return <ChatHomeClient guest={actor.isExternal} />;
}

export const dynamic = "force-dynamic";
