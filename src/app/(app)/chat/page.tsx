import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { ChatHomeClient } from "@/components/chat/home/chat-home-client";
import { currentSpace } from "@/server/services/current-space";
import { opensOnCards } from "@/lib/cards/shared";

/** The chat list is scoped again by the server API for this authenticated actor. */
export default async function ChatPage() {
  const { actor } = await pageActor();
  // a space of «لوحات» has no chat home: it opens on its cards (a topic link still opens, and «أرسل» writes into one)
  if (opensOnCards((await currentSpace(actor))?.layout)) redirect("/cards");
  // a meeting is started with the calls row's «يضيف ويعدّل» box
  return <ChatHomeClient guest={actor.isExternal} canMeet={!actor.isExternal && actorCan(actor, "calls.edit")} />;
}

export const dynamic = "force-dynamic";
