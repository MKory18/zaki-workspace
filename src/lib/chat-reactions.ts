/**
 * The reaction palette shown in the chat UI. It must stay identical to the
 * server allow-list (`ALLOWED_REACTIONS` in src/server/services/chat.ts);
 * tests/encoding-hygiene.test.ts fails if the two ever drift apart.
 * Kept in a server-free module so client components can import it.
 */
export const CHAT_REACTIONS = ["👍", "❤️", "😂", "🎉", "🔥", "👀"] as const;
