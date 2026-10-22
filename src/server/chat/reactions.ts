/**
 * The reaction palette of the chat, and the rule for any other emoji.
 *
 * Phase 3 accepts ANY single emoji (up to 16 chars, at most 12 distinct per message) — the six
 * below are only the quick bar the UI offers. `ALLOWED_REACTIONS` stays exported, identical to
 * `CHAT_REACTIONS` in `src/lib/chat-reactions.ts`: the encoding-hygiene test proves the two never
 * drift apart, and the UI imports the client-safe copy.
 */

export const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "🎉", "🔥", "👀"] as const;
export type Reaction = (typeof ALLOWED_REACTIONS)[number];

/** One grapheme (with an optional variation selector), no whitespace, at most 16 code units. */
const SINGLE_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\u200D\p{Extended_Pictographic})*$/u;

export function isSingleEmoji(emoji: string): boolean {
  const e = emoji.trim();
  if (!e || e.length > 16) return false;
  if (/\s/.test(e)) return false;
  // flags and keycaps: two regional indicators, or a digit/#/* plus the keycap
  if (/^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(e)) return true;
  if (/^[0-9#*]\uFE0F?\u20E3$/u.test(e)) return true;
  return SINGLE_EMOJI.test(e);
}

/** Is this one of the six quick-bar emoji? (Kept for the old call sites and the UI test.) */
export function isAllowedReaction(emoji: string): emoji is Reaction {
  return (ALLOWED_REACTIONS as readonly string[]).includes(emoji);
}
