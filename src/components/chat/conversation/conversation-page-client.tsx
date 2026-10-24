"use client";

import { useRouter } from "next/navigation";
import { ConversationScreen } from "./conversation-screen";

/** `/chat/[id]`: the conversation screen, filling the shell's main area; «رجوع» goes back to the chat list. */
export function ConversationPageClient({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  return <div className="mx-auto h-full min-h-0 w-full max-w-3xl">
    <ConversationScreen conversationId={conversationId} onBack={() => router.push("/chat")} />
  </div>;
}
