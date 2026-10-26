"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ExternalLink, MessageCircle, Square } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { useOptionalToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { watchErrorKey } from "./watch-home";
import { WatchPlayer, type WatchPlayerHandle, type WatchRemote } from "./watch-player";
import { WatchComments, type ConvertRights } from "./watch-comments";

export interface WatchRoomData {
  id: string;
  title: string;
  /** the video's own id at its site */
  ref: string;
  startSec: number;
  pageUrl: string;
  host: { id: string; name: string };
  people: { id: string; name: string }[];
  live: boolean;
  conversationId: string;
  spaceId: string;
  remote: WatchRemote;
  can: { end: boolean };
}

/**
 * One session: the video on top, on the same second on every screen (src/components/watch/watch-player.tsx), who is
 * in it, and one tap to the talk — the session's topic, where the call and the whiteboard already are.
 */
export function WatchRoom({
  session,
  viewerId,
  startAt = null,
  convert = { idea: false, task: false, project: false },
}: {
  session: WatchRoomData;
  viewerId: string;
  /** open the video at this second (`?t=`) */
  startAt?: number | null;
  convert?: ConvertRights;
}) {
  const { t } = useI18n();
  const toast = useOptionalToast();
  const router = useRouter();
  const [ending, setEnding] = useState(false);
  const player = useRef<WatchPlayerHandle>(null);
  // the reactions floating up over the video (each for a moment, then gone)
  const [floating, setFloating] = useState<{ id: number; emoji: string; left: number }[]>([]);
  const seq = useRef(0);
  const float = useCallback((emoji: string) => {
    const id = ++seq.current;
    setFloating((all) => [...all.slice(-11), { id, emoji, left: 10 + Math.random() * 75 }]);
    setTimeout(() => setFloating((all) => all.filter((f) => f.id !== id)), 2_600);
  }, []);

  async function end() {
    if (ending || !window.confirm(t("watch.end_confirm"))) return;
    setEnding(true);
    try {
      await apiPost(`/api/watch/${session.id}/end`);
      router.refresh();
    } catch (err) {
      toast?.toast(t(watchErrorKey(err)), "error");
    } finally {
      setEnding(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl gap-4 p-0 md:p-6 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <div className="min-w-0 space-y-3">
      <div className="md:rounded-xl md:border md:border-border md:bg-surface md:p-2">
        {/* the video is never taller than most of the screen (a phone on its side): the title and the buttons stay in view */}
        <WatchPlayer
          ref={player}
          jumpTo={startAt}
          overlay={
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
              {floating.map((f) => (
                <span key={f.id} className="absolute bottom-2 animate-float-up text-3xl" style={{ left: `${f.left}%` }}>
                  {f.emoji}
                </span>
              ))}
            </div>
          }
          sessionId={session.id}
          conversationId={session.conversationId}
          videoRef={session.ref}
          startSec={session.startSec}
          title={session.title}
          initial={session.remote}
          viewerId={viewerId}
          people={session.people}
        />
      </div>

      <div className="space-y-3 px-4 md:px-0">
        {!session.live ? (
          <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm text-fg-muted" role="status">
            {t("watch.ended")}
          </p>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-fg md:text-lg">
              <bdi>{session.title}</bdi>
            </h1>
            <p className="text-xs text-fg-muted">
              <bdi>{t("watch.by", { name: session.host.name })}</bdi>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/chat/${session.conversationId}`}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent/90 md:h-9"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {t("watch.open_talk")}
            </Link>
            <a
              href={session.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-border bg-surface px-4 text-sm text-fg hover:bg-surface-2 md:h-9"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {t("watch.open_site")}
            </a>
            {session.can.end ? (
              <Button variant="secondary" onClick={end} disabled={ending}>
                <Square className="h-4 w-4" aria-hidden="true" />
                {t("watch.end")}
              </Button>
            ) : null}
          </div>
        </div>

        <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
          <span>{t("watch.with")}</span>
          {session.people.map((p) => (
            <span key={p.id} className="rounded-full bg-surface-2 px-2 py-0.5 text-fg">
              <bdi>{p.name}</bdi>
            </span>
          ))}
        </p>

        <Link href="/watch" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          {t("watch.back")}
        </Link>
      </div>
      </div>

      <div className="mt-3 px-4 pb-4 md:px-0 lg:mt-0">
        <WatchComments
          conversationId={session.conversationId}
          session={{ id: session.id, title: session.title, spaceId: session.spaceId }}
          convert={convert}
          timeSec={() => player.current?.timeSec() ?? 0}
          seekMine={(sec) => player.current?.seekMine(sec)}
          onReaction={float}
        />
      </div>
    </div>
  );
}
