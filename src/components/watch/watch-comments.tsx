"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pin, Send } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { useOptionalToast } from "@/components/ui/toast";
import { MOMENT_MARK, QUICK_REACTIONS, fmtVideoTime, isKeyMoment, isReaction, keyMoments, momentText } from "@/lib/watch/moments";
import { watchErrorKey } from "./watch-home";
import { cn } from "@/lib/utils";

/** The part of a chat message the comments need (the session's talk is an ordinary topic). */
export interface WatchComment {
  id: string;
  kind: string;
  body: string | null;
  deleted: boolean;
  mine: boolean;
  authorName: string;
  createdAt: string;
  videoAtSec?: number | null;
}

/** How many comments the panel keeps (the newest; the whole talk stays in «الدردشة»). */
const PAGE = 50;

/**
 * The comments of a session, each tied to the moment of the video it was written at (the owner's ask: «ونعلّق»).
 * A comment takes the second the person's player is at by itself; a tap on its time takes the player there. Under the
 * box: quick reactions (one emoji at this moment, floating over everybody's video) and «📌 لحظة مهمة»; the key
 * moments, in the video's order, are the session's summary. Everything is an ordinary message of the session's topic,
 * so the call, the read marks and the rest of the chat work as they do anywhere.
 */
export function WatchComments({
  conversationId,
  timeSec,
  seekMine,
  onReaction,
}: {
  conversationId: string;
  /** the second this screen's player is at */
  timeSec: () => number;
  /** take this screen to a second */
  seekMine: (sec: number) => void;
  /** a reaction arrived (anybody's): float it over the video */
  onReaction: (emoji: string) => void;
}) {
  const { t } = useI18n();
  const toast = useOptionalToast();
  const [items, setItems] = useState<WatchComment[]>([]);
  const [canPost, setCanPost] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [onlyKey, setOnlyKey] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const listEnd = useRef<HTMLLIElement>(null);

  const load = useCallback(async () => {
    try {
      const detail = await apiGet<{ messages: WatchComment[]; me: { canPost: boolean } }>(`/api/chat/conversations/${conversationId}?limit=${PAGE}`);
      const fresh = detail.messages.filter((m) => m.kind !== "SYSTEM");
      // a reaction that arrived since the last look floats over the video (not the ones already there at the start)
      if (seen.current.size > 0) {
        for (const m of fresh) if (!seen.current.has(m.id) && !m.deleted && isReaction(m.body)) onReaction(m.body!.trim());
      }
      seen.current = new Set(fresh.map((m) => m.id));
      setItems(fresh);
      setCanPost(detail.me.canPost);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, [conversationId, onReaction]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime((e) => {
    if (e.conversationId !== conversationId) return;
    if (e.kind.startsWith("message.") || e.kind === "conversation.changed" || e.kind === "membership.changed") void load();
  });

  // the newest comment in view
  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "nearest" });
  }, [items.length]);

  async function send(body: string) {
    const clean = body.trim();
    if (!clean || sending) return;
    setSending(true);
    try {
      const at = Math.max(0, timeSec());
      await apiPost(`/api/chat/conversations/${conversationId}/messages`, { body: clean, videoAtSec: at, clientId: `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
      if (isReaction(clean)) onReaction(clean);
      await load();
    } catch (err) {
      toast?.toast(t(watchErrorKey(err)), "error");
    } finally {
      setSending(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text;
    setText("");
    await send(body);
  }

  const moments = useMemo(() => keyMoments(items), [items]);
  const shown = onlyKey ? moments : items.filter((m) => !isReaction(m.body));

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-border bg-surface" aria-label={t("watch.comments.title")}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-fg">{t("watch.comments.title")}</h2>
        <button
          type="button"
          aria-pressed={onlyKey}
          onClick={() => setOnlyKey((v) => !v)}
          className={cn(
            "inline-flex min-h-9 items-center gap-1 rounded-full border px-2.5 text-xs md:min-h-7",
            onlyKey ? "border-accent bg-accent/10 text-accent" : "border-border text-fg-muted hover:bg-surface-2",
          )}
        >
          <Pin className="h-3.5 w-3.5" aria-hidden="true" />
          {t("watch.comments.key_moments", { n: moments.length })}
        </button>
      </header>

      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 lg:max-h-[55vh]" aria-live="polite">
        {loaded && shown.length === 0 ? (
          <li className="py-6 text-center text-xs text-muted">{t(onlyKey ? "watch.comments.no_key" : "watch.comments.empty")}</li>
        ) : null}
        {shown.map((m) => (
          <li key={m.id} className={cn("flex items-start gap-2 text-sm", m.deleted && "opacity-60")}>
            {typeof m.videoAtSec === "number" ? (
              <button
                type="button"
                onClick={() => seekMine(m.videoAtSec as number)}
                title={t("watch.comments.jump")}
                className="mt-0.5 shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-xs text-accent hover:bg-accent/20"
                dir="ltr"
              >
                {fmtVideoTime(m.videoAtSec)}
              </button>
            ) : (
              <span className="mt-0.5 w-10 shrink-0" aria-hidden="true" />
            )}
            <p className="min-w-0 flex-1 break-words">
              <bdi className="font-medium text-fg">{m.authorName}</bdi>
              <span className="text-fg-muted">: </span>
              {m.deleted ? (
                <span className="text-muted">{t("watch.comments.deleted")}</span>
              ) : isKeyMoment(m.body) ? (
                <span className="text-fg">
                  <span aria-hidden="true">{MOMENT_MARK} </span>
                  <bdi>{momentText(m.body ?? "") || t("watch.comments.key_moment")}</bdi>
                </span>
              ) : (
                <bdi className="text-fg">{m.body}</bdi>
              )}
            </p>
          </li>
        ))}
        <li ref={listEnd} aria-hidden="true" />
      </ol>

      {canPost ? (
        <div className="space-y-2 border-t border-border p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                disabled={sending}
                onClick={() => send(emoji)}
                aria-label={t("watch.comments.react", { emoji })}
                className="grid size-10 place-items-center rounded-full border border-border text-lg hover:bg-surface-2 md:size-8 md:text-base"
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              disabled={sending}
              onClick={() => send(text.trim() ? `${MOMENT_MARK} ${text.trim()}` : MOMENT_MARK).then(() => setText(""))}
              className="inline-flex h-10 items-center gap-1 rounded-full border border-border px-3 text-xs text-fg hover:bg-surface-2 md:h-8"
            >
              <Pin className="h-3.5 w-3.5" aria-hidden="true" />
              {t("watch.comments.mark")}
            </button>
          </div>
          <form onSubmit={submit} className="flex items-center gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              placeholder={t("watch.comments.placeholder")}
              aria-label={t("watch.comments.placeholder")}
              className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface-1 px-3 text-sm text-fg md:h-9"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              aria-label={t("watch.comments.send")}
              className="grid size-11 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg disabled:opacity-50 md:size-9"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </div>
      ) : loaded ? (
        <p className="border-t border-border p-3 text-xs text-muted">{t("watch.comments.read_only")}</p>
      ) : null}
    </section>
  );
}
