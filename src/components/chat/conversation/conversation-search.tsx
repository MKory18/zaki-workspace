"use client";

import React, { useEffect, useState } from "react";
import type { MessageHitDto } from "@/server/chat/dto";
import { ct } from "@/lib/chat/text";
import { dayDiff, fmtShort, fmtTime } from "@/lib/format";

/** Today's hit shows its time, an older one its day (the app's own formatting, src/lib/format.ts). */
function whenOf(at: string): string {
  return dayDiff(at) === 0 ? fmtTime(at) : fmtShort(at);
}

/**
 * «بحث بالمحادثة» (the owner's ask, 2026-10-25): the messages of this conversation that carry the words, newest
 * first; picking one opens the conversation around it (the screen scrolls to it and marks it).
 */
export function ConversationSearch({
  conversationId,
  onPick,
  onClose,
}: {
  conversationId: string;
  onPick: (messageId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MessageHitDto[] | null>(null);
  const [failed, setFailed] = useState(false);

  // a short pause after typing, then one request (the last one wins)
  useEffect(() => {
    const words = q.trim();
    if (words.length < 2) {
      setHits(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/search?q=${encodeURIComponent(words)}`, { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error("search");
          return r.json() as Promise<{ hits: MessageHitDto[] }>;
        })
        .then((data) => {
          if (!alive) return;
          setFailed(false);
          setHits(data.hits);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, conversationId]);

  return (
    <div className="border-b border-border p-3">
      <div className="flex items-center gap-2">
        <input
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          aria-label={ct("chatc.search.label")}
          placeholder={ct("chatc.search.placeholder")}
          enterKeyHint="search"
          className="h-11 min-w-0 flex-1 rounded-lg border border-muted bg-surface px-3 text-base md:h-9 md:text-sm"
        />
        <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-surface-2">
          {ct("chatc.search.close")}
        </button>
      </div>
      {failed && <p role="alert" className="mt-2 text-sm text-danger">{ct("chatc.search.failed")}</p>}
      {hits && !failed && (
        <div role="status" className="mt-2">
          {hits.length === 0 ? (
            <p className="text-sm text-fg-muted">{ct("chatc.search.none")}</p>
          ) : (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => onPick(h.id)} className="flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2 text-start hover:bg-surface-2">
                    <span className="flex w-full items-center gap-2 text-xs text-fg-muted">
                      <bdi className="min-w-0 flex-1 truncate">{h.authorName}</bdi>
                      <small className="shrink-0">{whenOf(h.at)}</small>
                    </span>
                    <span className="line-clamp-2 text-sm">{h.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
