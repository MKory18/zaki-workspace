import { db } from "@/server/db";

/**
 * System messages: no body of their own — the client composes the Arabic sentence from the
 * `{k, p}` stored in `body` (ChatMessage has no meta column). Keys: join | leave | pin |
 * unpin | close | reopen | member_added | member_removed | forwarded.
 */
export function systemMessage(k: string, p: Record<string, string | number> = {}): string {
  return JSON.stringify({ k, p });
}

/** Writes a system message row for the given conversation. */
export async function writeSystemMessage(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  opts: { orgId: string; conversationId: string; authorId: string; k: string; p?: Record<string, string | number> },
): Promise<void> {
  await tx.chatMessage.create({
    data: {
      orgId: opts.orgId,
      conversationId: opts.conversationId,
      authorId: opts.authorId,
      body: systemMessage(opts.k, opts.p ?? {}),
      kind: "SYSTEM",
    },
  });
}
