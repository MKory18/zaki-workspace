"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AudioPresets, Room, RoomEvent, ScreenSharePresets, Track, VideoPresets, type DisconnectReason, type Participant, type Track as LkTrack } from "livekit-client";
import { ct } from "@/lib/chat/text";
import { isDrop, isFresh, MAX_REJOINS, miniVisible, rejoinDelayMs } from "@/lib/calls/session";
import { useOptionalToast } from "@/components/ui/toast";
import { callApi, callErrorText, type CallView } from "./call-api";
import { AudioOut, mainPicture, PersonPicture } from "./call-media";

/**
 * THE CALL KEEPER — one live call per tab, kept above every page of the app (mounted in the (app) layout), so the call
 * goes on while the person opens the chat, a task, anything: nothing ends it but «اطلع», being taken out, or the call
 * ending. Away from the call's page it shrinks to a small window in the corner (the picture, the microphone, back to
 * the call, leave), with picture-in-picture where the browser has it. A drop by the network (the phone asleep, a
 * changed network) is joined again quietly, a few times with a growing pause. The voices play from here, so they never
 * stop when a page changes.
 *
 * The connection favours the voice: adaptive stream and dynacast, simulcast layers, Opus speech with DTX and RED, a
 * muted microphone kept open; the picture degrades first when the network weakens.
 */

export type CallPhase = "idle" | "connecting" | "in" | "lost" | "left" | "ended" | "removed" | "denied";

interface CallState {
  callId: string | null;
  phase: CallPhase;
  error: string;
  reconnecting: boolean;
  needsAudioTap: boolean;
}

export interface CallApi {
  state: CallState;
  room: Room | null;
  /** everybody in the room, the person first */
  everyone: Participant[];
  join: (callId: string, video: boolean) => Promise<void>;
  leave: () => Promise<void>;
  toggle: (what: "mic" | "cam" | "screen") => Promise<void>;
  startAudio: () => Promise<void>;
  /** fetch the pass and warm the connection while the phone rings, so «ردّ» is instant */
  prefetch: (callId: string) => void;
}

const CallContext = React.createContext<CallApi | null>(null);

export function useCall(): CallApi {
  const api = React.useContext(CallContext);
  if (!api) throw new Error("useCall outside <CallProvider>");
  return api;
}

/** The call keeper, or null outside the app's frame (a page rendered on its own, a test). */
export function useOptionalCall(): CallApi | null {
  return React.useContext(CallContext);
}

const MEMO_KEY = "zk-active-call";

/** The call this tab is in, kept across a reload of the page (switching space reloads it): {id, video}. */
function remember(call: { id: string; video: boolean } | null): void {
  try {
    if (call) sessionStorage.setItem(MEMO_KEY, JSON.stringify(call));
    else sessionStorage.removeItem(MEMO_KEY);
  } catch {
    // private window: the call still works, only a reload forgets it
  }
}

function remembered(): { id: string; video: boolean } | null {
  try {
    const raw = sessionStorage.getItem(MEMO_KEY);
    const v = raw ? (JSON.parse(raw) as { id?: unknown; video?: unknown }) : null;
    return v && typeof v.id === "string" ? { id: v.id, video: v.video === true } : null;
  } catch {
    return null;
  }
}

function newRoom(): Room {
  return new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: VideoPresets.h720.resolution, facingMode: "user" },
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    publishDefaults: {
      simulcast: true,
      videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
      // VP9 where the browser has it, VP8 for the others (and for whoever cannot decode VP9)
      videoCodec: "vp9",
      backupCodec: { codec: "vp8" },
      // a shared screen is text: sharp, at a calm frame rate
      screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
      audioPreset: AudioPresets.speech,
      dtx: true,
      red: true,
      // a muted microphone stays open: unmuting is instant, with no new permission prompt
      stopMicTrackOnMute: false,
    },
  });
}

interface Pass {
  url: string;
  token: string;
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const toast = useOptionalToast();
  const pathname = usePathname();
  const [state, setState] = React.useState<CallState>({ callId: null, phase: "idle", error: "", reconnecting: false, needsAudioTap: false });
  const roomRef = React.useRef<Room | null>(null);
  const joining = React.useRef(false);
  const lastVideo = React.useRef(false);
  const rejoins = React.useRef(0);
  const prefetched = React.useRef<{ callId: string; pass: Pass; at: number } | null>(null);
  // the page is going away (a reload, switching space): the disconnect that follows is not a choice
  const unloading = React.useRef(false);
  React.useEffect(() => {
    const going = () => {
      unloading.current = true;
    };
    window.addEventListener("pagehide", going);
    window.addEventListener("beforeunload", going);
    return () => {
      window.removeEventListener("pagehide", going);
      window.removeEventListener("beforeunload", going);
    };
  }, []);
  // every change in the room (somebody came, a camera went on) draws again
  const [, setTick] = React.useState(0);
  const redraw = React.useCallback(() => setTick((n) => n + 1), []);
  const patch = React.useCallback((p: Partial<CallState>) => setState((s) => ({ ...s, ...p })), []);

  const say = React.useCallback((text: string) => {
    if (toast) toast.toast(text, "error");
  }, [toast]);

  const passFor = React.useCallback(async (callId: string): Promise<Pass> => {
    const warm = prefetched.current;
    prefetched.current = null;
    if (warm && warm.callId === callId && isFresh(warm.at, Date.now())) return warm.pass;
    return callApi<Pass>(`/api/calls/${encodeURIComponent(callId)}/token`, {});
  }, []);

  const join = React.useCallback(async (callId: string, video: boolean) => {
    if (joining.current) return;
    if (roomRef.current && state.callId === callId && (state.phase === "in" || state.phase === "connecting")) return;
    joining.current = true;
    lastVideo.current = video;
    // one call at a time: a new one closes the old one
    const old = roomRef.current;
    roomRef.current = null;
    if (old) await old.disconnect().catch(() => undefined);
    setState({ callId, phase: "connecting", error: "", reconnecting: false, needsAudioTap: false });
    const room = newRoom();
    for (const ev of [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ConnectionQualityChanged,
    ]) {
      room.on(ev, redraw);
    }
    room.on(RoomEvent.Reconnecting, () => patch({ reconnecting: true }));
    room.on(RoomEvent.Reconnected, () => patch({ reconnecting: false }));
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => patch({ needsAudioTap: !room.canPlaybackAudio }));
    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (roomRef.current !== room || unloading.current) return; // «اطلع», a newer call, or the page reloading (it comes back)
      roomRef.current = null;
      const code = reason as unknown as number | undefined;
      if (isDrop(code)) {
        patch({ phase: "lost", reconnecting: true });
        return;
      }
      remember(null);
      patch({ phase: code === 4 ? "removed" : code === 5 || code === 10 ? "ended" : "left", reconnecting: false });
    });
    try {
      let pass: Pass;
      try {
        pass = await passFor(callId);
      } catch (e) {
        // the server's refusal, already in Arabic (ended, not yours, no calls server)
        remember(null);
        const ended = e instanceof Error && e.message === callErrorText("calls.e.ended");
        patch({ phase: ended ? "ended" : "denied", error: e instanceof Error ? e.message : ct("calls.failed") });
        return;
      }
      try {
        await room.connect(pass.url, pass.token);
      } catch {
        // the calls server's own words are English: the person reads ours
        void room.disconnect();
        patch({ phase: "lost", error: ct("calls.failed") });
        return;
      }
      roomRef.current = room;
      rejoins.current = 0;
      remember({ id: callId, video });
      patch({ phase: "in", reconnecting: false, needsAudioTap: !room.canPlaybackAudio });
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        if (video) await room.localParticipant.setCameraEnabled(true);
      } catch {
        // no permission, or no device: the person is in and hears everybody; the buttons ask again
        say(ct("calls.no_media"));
      }
      redraw();
    } finally {
      joining.current = false;
    }
  }, [passFor, patch, redraw, say, state.callId, state.phase]);

  // a drop is joined again quietly, with a growing pause, when the tab is visible and online
  React.useEffect(() => {
    if (state.phase !== "lost" || !state.callId) return;
    if (rejoins.current >= MAX_REJOINS) {
      patch({ reconnecting: false });
      return;
    }
    const callId = state.callId;
    const attempt = ++rejoins.current;
    const t = setTimeout(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        rejoins.current--; // wait for the person to come back; visibility below tries again
        return;
      }
      void join(callId, lastVideo.current);
    }, rejoinDelayMs(attempt));
    return () => clearTimeout(t);
  }, [state.phase, state.callId, join, patch]);

  // back from another app on a phone: a camera or microphone the system stopped while the app was hidden is started
  // again, so the picture and the voice come back without a tap
  React.useEffect(() => {
    const revive = () => {
      const room = roomRef.current;
      if (!room || document.visibilityState !== "visible") return;
      for (const source of [Track.Source.Camera, Track.Source.Microphone]) {
        const track = room.localParticipant.getTrackPublication(source)?.track;
        if (track && !track.isMuted && track.mediaStreamTrack.readyState === "ended") {
          void track.restartTrack().catch(() => undefined);
        }
      }
    };
    document.addEventListener("visibilitychange", revive);
    return () => document.removeEventListener("visibilitychange", revive);
  }, []);

  // back on the tab, or back online: a lost call is tried again at once
  React.useEffect(() => {
    const again = () => {
      if (state.phase === "lost" && state.callId && document.visibilityState === "visible") void join(state.callId, lastVideo.current);
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("online", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("online", again);
    };
  }, [state.phase, state.callId, join]);

  // after a reload (switching space reloads the page) the call is not lost: it is joined again by itself
  const joinRef = React.useRef(join);
  joinRef.current = join;
  React.useEffect(() => {
    const memo = remembered();
    if (!memo || roomRef.current) return;
    void callApi<CallView>(`/api/calls/${encodeURIComponent(memo.id)}`).then(
      (v) => {
        if (v.endedAt) remember(null);
        else void joinRef.current(memo.id, memo.video);
      },
      () => remember(null),
    );
  }, []);

  const leave = React.useCallback(async () => {
    const room = roomRef.current;
    const callId = state.callId;
    roomRef.current = null;
    remember(null);
    if (room) await room.disconnect().catch(() => undefined);
    if (callId) await fetch(`/api/calls/${encodeURIComponent(callId)}/leave`, { method: "POST" }).catch(() => undefined);
    patch({ phase: "left", reconnecting: false });
  }, [patch, state.callId]);

  const toggle = React.useCallback(async (what: "mic" | "cam" | "screen") => {
    const room = roomRef.current;
    if (!room) return;
    const me = room.localParticipant;
    try {
      if (what === "mic") await me.setMicrophoneEnabled(!me.isMicrophoneEnabled);
      else if (what === "cam") await me.setCameraEnabled(!me.isCameraEnabled);
      else await me.setScreenShareEnabled(!me.isScreenShareEnabled, { audio: true, contentHint: "detail" });
    } catch {
      if (what !== "screen") say(ct("calls.no_media"));
    }
    redraw();
  }, [redraw, say]);

  const startAudio = React.useCallback(async () => {
    await roomRef.current?.startAudio();
    patch({ needsAudioTap: false });
  }, [patch]);

  const prefetch = React.useCallback((callId: string) => {
    if (roomRef.current) return; // already in a call: «ردّ» will switch anyway
    void callApi<Pass>(`/api/calls/${encodeURIComponent(callId)}/token`, {}).then(
      (pass) => {
        prefetched.current = { callId, pass, at: Date.now() };
        void newRoom().prepareConnection(pass.url, pass.token).catch(() => undefined);
      },
      () => undefined,
    );
  }, []);

  const room = roomRef.current;
  const everyone: Participant[] = room ? [room.localParticipant, ...room.remoteParticipants.values()] : [];
  const api: CallApi = { state, room, everyone, join, leave, toggle, startAudio, prefetch };
  const sounds = everyone
    .filter((p) => p !== room?.localParticipant)
    .flatMap((p) => [p.getTrackPublication(Track.Source.Microphone)?.track, p.getTrackPublication(Track.Source.ScreenShareAudio)?.track])
    .filter((t): t is LkTrack => !!t);
  const showMini = miniVisible(pathname, state.callId) && (state.phase === "in" || state.phase === "connecting" || state.phase === "lost");

  return (
    <CallContext.Provider value={api}>
      {children}
      {sounds.map((t) => (
        <AudioOut key={t.sid} track={t} />
      ))}
      {showMini && <MiniCall api={api} />}
    </CallContext.Provider>
  );
}

/** The call while the person is on another page: a small window in the corner. */
function MiniCall({ api }: { api: CallApi }) {
  const { state, room, everyone } = api;
  const me = room?.localParticipant;
  const main = mainPicture(everyone, me);
  const video = React.useRef<HTMLVideoElement>(null);
  const href = `/calls/${encodeURIComponent(state.callId ?? "")}`;
  const canPip = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;

  return (
    <aside dir="rtl" lang="ar" aria-label={ct("calls.mini")} className="fixed bottom-20 end-3 z-[55] w-44 overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-lg md:bottom-4">
      <Link href={href} className="relative block aspect-video bg-surface-2" aria-label={ct("calls.back_to_call")}>
        {main && room ? (
          <PersonPicture p={main.p} me={me} source={main.source} fit={main.source === Track.Source.ScreenShare ? "contain" : "cover"} small />
        ) : (
          <span className="flex h-full items-center justify-center text-xs text-fg-muted">{ct("calls.connecting")}</span>
        )}
        {state.reconnecting && <span className="absolute inset-x-0 top-0 bg-warn/80 px-1 text-center text-xs text-fg">{ct("calls.reconnecting_short")}</span>}
        {/* a hidden copy of the main picture for picture-in-picture */}
        {main && room && <HiddenVideo ref={video} p={main.p} source={main.source} />}
      </Link>
      <div className="flex items-center justify-between gap-1 p-1.5">
        <button type="button" onClick={() => void api.toggle("mic")} aria-pressed={!!me?.isMicrophoneEnabled} aria-label={me?.isMicrophoneEnabled ? ct("calls.mic_off") : ct("calls.mic_on")} className="h-9 w-9 rounded-full border border-border text-base">
              <span aria-hidden="true">{me?.isMicrophoneEnabled ? "🎙️" : "🔇"}</span>
            </button>
            {canPip && main && (
              <button type="button" onClick={() => void video.current?.requestPictureInPicture().catch(() => undefined)} aria-label={ct("calls.pip")} title={ct("calls.pip")} className="h-9 w-9 rounded-full border border-border text-base">
                <span aria-hidden="true">🪟</span>
              </button>
            )}
            <button type="button" onClick={() => void api.leave()} aria-label={ct("calls.leave")} title={ct("calls.leave")} className="h-9 w-9 rounded-full bg-danger text-base text-danger-fg">
          <span aria-hidden="true">📴</span>
        </button>
      </div>
    </aside>
  );
}

/** The main picture again, off screen, for the browser's picture-in-picture window. */
const HiddenVideo = React.forwardRef<HTMLVideoElement, { p: Participant; source: Track.Source }>(function HiddenVideo({ p, source }, outer) {
  const track = p.getTrackPublication(source)?.track;
  const inner = React.useRef<HTMLVideoElement | null>(null);
  React.useEffect(() => {
    const el = inner.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <video
      ref={(el) => {
        inner.current = el;
        if (typeof outer === "function") outer(el);
        else if (outer) outer.current = el;
      }}
      autoPlay
      playsInline
      muted
      aria-hidden="true"
      className="pointer-events-none absolute h-px w-px opacity-0"
    />
  );
});
