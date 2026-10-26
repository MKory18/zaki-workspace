import { pageActor } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { ChatHomeClient } from "@/components/chat/home/chat-home-client";

/** The chat list is scoped again by the server API for this authenticated actor. */
export default async function ChatPage() {
  const { actor } = await pageActor();
  // a meeting is started with the calls row's «يضيف ويعدّل» box
  return <ChatHomeClient guest={actor.isExternal} canMeet={!actor.isExternal && actorCan(actor, "calls.edit")} />;
}

export const dynamic = "force-dynamic";
