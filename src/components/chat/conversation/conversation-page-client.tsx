"use client";

import { useRouter } from "next/navigation";
import { ConversationScreen } from "./conversation-screen";

/**
 * `/chat/[id]`: the conversation screen, filling the shell's main area; «رجوع» goes back to the chat list. `?m=` (a
 * search hit, a notification) opens it around that message.
 */
export function ConversationPageClient({ conversationId, focusMessageId }: { conversationId: string; focusMessageId?: string }) {
  const router = useRouter();
  return <div className="mx-auto h-full min-h-0 w-full max-w-3xl">
    <ConversationScreen conversationId={conversationId} focusMessageId={focusMessageId} onBack={() => router.push("/chat")} />
  </div>;
}
