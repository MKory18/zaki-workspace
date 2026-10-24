"use client";

import { useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRealtime } from "@/lib/realtime/use-realtime";

export const CHAT_UNREAD_KEY = ["chat-unread"] as const;

/** What the badge shows: nothing at 0, the number up to 9, then «9+» (like the bell). */
export function badgeText(total: number): string | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return total > 9 ? "9+" : String(Math.floor(total));
}

/** The events that can move the number: a new message anywhere, my read mark, a door that opened or closed. */
export const MOVES_UNREAD = new Set(["message.created", "message.deleted", "conversation.read", "membership.changed", "conversation.changed"]);

/**
 * The unread total behind «الدردشة»: fetched once, refreshed every 30 s, and at once (folded into one
 * request per 400 ms) when a realtime event that can move it arrives.
 */
export function useChatUnread(enabled = true): number {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: CHAT_UNREAD_KEY,
    queryFn: async () => {
      const r = await fetch("/api/chat/unread", { cache: "no-store" });
      if (!r.ok) throw new Error("chat-unread");
      return (await r.json()) as { total: number };
    },
    refetchInterval: 30_000,
    enabled,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime((event) => {
    if (!enabled || !MOVES_UNREAD.has(event.kind)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void qc.invalidateQueries({ queryKey: CHAT_UNREAD_KEY });
    }, 400);
  });
  return query.data?.total ?? 0;
}
