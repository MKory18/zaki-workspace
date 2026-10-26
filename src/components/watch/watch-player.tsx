"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Hand, Play, Radio, RotateCcw, Users } from "lucide-react";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { useOptionalToast } from "@/components/ui/toast";
import { DRIFT_CHECK_MS, clockOffset, expectedPosition, followPlan, isNewer, isRemotePress, type RemoteState } from "@/lib/watch/sync";
import { createPlayer, YT_STATE, type YtPlayer } from "./youtube";
import { watchErrorKey } from "./watch-home";
import { cn } from "@/lib/utils";

export interface WatchRemote {
  state: RemoteState;
  serverNow: number;
  hostId: string;
  everyoneControls: boolean;
  live: boolean;
  can: { press: boolean; handOver: boolean };
}

/** After the screen moves its own player to follow, its player's own events are not presses for this long. */
const APPLY_QUIET_MS = 1_200;
/** How often whoever holds the remote is checked for a jump (YouTube tells no «seeked»). */
const PRESS_CHECK_MS = 1_000;
/** A play the browser refused (no tap yet): asked again with a button after this long. */
const PLAY_REFUSED_MS = 1_500;

/**
 * The video of a session, on the same second on every screen. Whoever holds the remote plays, pauses and jumps for
 * everybody; everybody else follows, and may step away (pause on their own) and come back with one tap. A late
 * joiner lands where the others are. The press travels as a few numbers over the app's own realtime channel.
 */
export function WatchPlayer({
  sessionId,
  conversationId,
  videoRef,
  startSec,
  title,
  initial,
  viewerId,
  people,
}: {
  sessionId: string;
  conversationId: string;
  videoRef: string;
  startSec: number;
  title: string;
  initial: WatchRemote;
  viewerId: string;
  people: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const toast = useOptionalToast();
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<YtPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [remote, setRemote] = useState<WatchRemote>(initial);
  const [detached, setDetached] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [handTo, setHandTo] = useState("");

  // what the handlers read without being rebuilt
  const live = useRef({ remote: initial, offset: initial.serverNow - Date.now(), detached: false, quietUntil: 0, lastPress: 0 });
  live.current.remote = remote;
  live.current.detached = detached;

  const serverNow = () => Date.now() + live.current.offset;
  const playerNow = (p: YtPlayer) => ({ timeSec: p.getCurrentTime() || 0, playing: p.getPlayerState() === YT_STATE.PLAYING || p.getPlayerState() === YT_STATE.BUFFERING });

  /** Move this screen's player to where the others are (the least it must). */
  const follow = useCallback(() => {
    const p = player.current;
    const { remote: r, detached: away } = live.current;
    // an ended session leaves every screen free; one who stepped away is left alone until they come back
    if (!p || away || !r.live) return;
    const plan = followPlan(r.state, serverNow(), playerNow(p));
    if (plan.seekTo === null && !plan.play && !plan.pause) return;
    live.current.quietUntil = Date.now() + APPLY_QUIET_MS;
    if (plan.seekTo !== null) p.seekTo(plan.seekTo, true);
    if (plan.pause) p.pauseVideo();
    if (plan.play) {
      p.playVideo();
      // a browser that wants a tap before sound plays nothing: offer the tap
      setTimeout(() => {
        const q = player.current;
        if (q && live.current.remote.state.playing && !live.current.detached && q.getPlayerState() !== YT_STATE.PLAYING && q.getPlayerState() !== YT_STATE.BUFFERING) setNeedsTap(true);
      }, PLAY_REFUSED_MS);
    }
  }, []);

  /** Take a newer remote (an older answer that arrived late is dropped), then follow what is held. */
  const take = useCallback(
    (next: WatchRemote) => {
      const held = live.current.remote;
      if (isNewer(next.state, held.state) || next.live !== held.live) {
        live.current.remote = next;
        setRemote(next);
      }
      follow();
    },
    [follow],
  );

  /** Ask the server where the session is, and how far its clock is from this device's. */
  const refresh = useCallback(async () => {
    const sentAt = Date.now();
    try {
      const { remote: next } = await apiGet<{ remote: WatchRemote }>(`/api/watch/${sessionId}/remote`);
      live.current.offset = clockOffset(sentAt, next.serverNow, Date.now());
      take(next);
    } catch {
      // the next event or check asks again
    }
  }, [sessionId, take]);

  /** Whoever holds the remote pressed it: tell the server (and so everybody). */
  const press = useCallback(async () => {
    const p = player.current;
    const r = live.current.remote;
    if (!p || !r.can.press || !r.live) return;
    const now = playerNow(p);
    if (!isRemotePress(r.state, serverNow(), now)) return;
    live.current.lastPress = Date.now();
    // show it at once on this screen; the server's answer (one version higher) confirms it
    live.current.remote = { ...r, state: { ...r.state, playing: now.playing, positionSec: now.timeSec, stateAt: serverNow() } };
    try {
      const { remote: next } = await apiPost<{ remote: WatchRemote }>(`/api/watch/${sessionId}/remote`, { playing: now.playing, positionSec: now.timeSec });
      live.current.remote = r; // let the confirmed version in
      take(next);
    } catch (err) {
      toast?.toast(t(watchErrorKey(err)), "error");
      void refresh();
    }
  }, [sessionId, take, refresh, toast, t]);

  // the player
  useEffect(() => {
    let gone = false;
    const el = document.createElement("div");
    box.current?.appendChild(el);
    createPlayer(el, videoRef, startSec, {
      onReady: () => {
        if (gone) return;
        setReady(true);
      },
      onStateChange: (e) => {
        if (Date.now() < live.current.quietUntil) return;
        if (e.data !== YT_STATE.PLAYING && e.data !== YT_STATE.PAUSED && e.data !== YT_STATE.ENDED) return;
        setNeedsTap(false);
        const r = live.current.remote;
        if (r.can.press && r.live) {
          void press();
          return;
        }
        // somebody who follows paused or played on their own: they stepped away from the others
        const playing = e.data === YT_STATE.PLAYING;
        if (r.live && playing !== r.state.playing) setDetached(true);
      },
    })
      .then((p) => {
        if (gone) p.destroy();
        else player.current = p;
      })
      .catch(() => toast?.toast(t("watch.player_failed"), "error"));
    return () => {
      gone = true;
      player.current?.destroy();
      player.current = null;
      el.remove();
    };
    // the player is made once per session page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef]);

  // once the player is there: where are the others?
  useEffect(() => {
    if (ready) void refresh();
  }, [ready, refresh]);

  // a press anywhere, or the session ending: ask again
  useRealtime((e) => {
    if (e.conversationId !== conversationId) return;
    if (e.kind === "watch.changed" || e.kind === "conversation.changed") void refresh();
  });

  // the one who follows checks itself; the one who holds the remote is watched for a jump
  useEffect(() => {
    if (!ready) return;
    const followTimer = setInterval(() => {
      if (!live.current.remote.can.press) follow();
    }, DRIFT_CHECK_MS);
    const pressTimer = setInterval(() => {
      const r = live.current.remote;
      if (r.can.press && r.live && Date.now() >= live.current.quietUntil && Date.now() - live.current.lastPress > PRESS_CHECK_MS) void press();
    }, PRESS_CHECK_MS);
    return () => {
      clearInterval(followTimer);
      clearInterval(pressTimer);
    };
  }, [ready, follow, press]);

  function rejoin() {
    setDetached(false);
    live.current.detached = false;
    setNeedsTap(false);
    follow();
  }

  function tapToJoin() {
    setNeedsTap(false);
    const p = player.current;
    if (!p) return;
    live.current.quietUntil = Date.now() + APPLY_QUIET_MS;
    p.seekTo(expectedPosition(live.current.remote.state, serverNow()), true);
    p.playVideo();
  }

  async function handOver(body: { hostId?: string; everyoneControls?: boolean }) {
    try {
      const { remote: next } = await apiPatch<{ remote: WatchRemote }>(`/api/watch/${sessionId}/remote`, body);
      take(next);
      setHandTo("");
    } catch (err) {
      toast?.toast(t(watchErrorKey(err)), "error");
    }
  }

  const holder = people.find((p) => p.id === remote.hostId)?.name ?? "";
  const iHold = remote.hostId === viewerId;
  const others = people.filter((p) => p.id !== remote.hostId);

  return (
    <div className="space-y-2">
      <div className="relative mx-auto aspect-video w-full max-w-[calc(65vh*16/9)] overflow-hidden bg-scrim md:rounded-lg">
        <div ref={box} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" aria-label={t("watch.player", { title })} />
        {needsTap ? (
          <button
            type="button"
            onClick={tapToJoin}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-scrim/70 text-on-photo"
          >
            <span className="grid size-16 place-items-center rounded-full bg-accent text-accent-fg">
              <Play className="size-7" aria-hidden="true" />
            </span>
            <span className="text-sm font-medium">{t("watch.tap_to_join")}</span>
          </button>
        ) : null}
      </div>

      {remote.live ? (
        <div className="space-y-2 px-4 md:px-0">
          {detached ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/40 bg-warn/10 p-2.5" role="status">
              <p className="text-sm text-fg">{t("watch.detached")}</p>
              <button type="button" onClick={rejoin} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg md:h-8">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {t("watch.rejoin")}
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1.5">
              <Radio className={cn("h-3.5 w-3.5", remote.can.press ? "text-accent" : "text-muted")} aria-hidden="true" />
              {remote.everyoneControls ? t("watch.remote.everyone") : iHold ? t("watch.remote.mine") : <bdi>{t("watch.remote.with", { name: holder })}</bdi>}
            </span>
            {remote.can.handOver ? (
              <>
                {others.length > 0 && !remote.everyoneControls ? (
                  <span className="inline-flex items-center gap-1.5">
                    <select
                      value={handTo}
                      onChange={(e) => setHandTo(e.target.value)}
                      aria-label={t("watch.remote.give_to")}
                      className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-fg md:h-7"
                    >
                      <option value="">{t("watch.remote.give_to")}</option>
                      {others.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!handTo}
                      onClick={() => handOver({ hostId: handTo })}
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-2 text-xs text-fg hover:bg-surface-2 disabled:opacity-50 md:h-7"
                    >
                      <Hand className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("watch.remote.give")}
                    </button>
                  </span>
                ) : null}
                <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 md:min-h-7">
                  <input type="checkbox" checked={remote.everyoneControls} onChange={(e) => handOver({ everyoneControls: e.target.checked })} className="accent-accent" />
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("watch.remote.everyone_toggle")}
                </label>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
