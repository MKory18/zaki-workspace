"use client";

import React from "react";
import Link from "next/link";
import {
  AudioPresets,
  ConnectionQuality,
  DisconnectReason,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  VideoPresets,
  type Participant,
  type Track as LkTrack,
} from "livekit-client";
import { ct, ctCount } from "@/lib/chat/text";
import { bestGrid } from "@/lib/calls/layout";
import { Avatar } from "@/components/ui/avatar";
import { useOptionalToast } from "@/components/ui/toast";
import { callApi, type CallView } from "./call-api";
import { CallInvite } from "./call-invite";

/**
 * The page of one call, as simple as a phone call (the owner's bar: «السلاسة وعدم التعقيد ولا الخطوات الزائدة»):
 * opening it joins at once — the microphone on, the camera as the call was started — with no screen in between.
 * The call takes the whole screen (the app's bars step aside), the pictures share it by size and orientation
 * (src/lib/calls/layout.ts), a shared screen becomes the stage with the people in a strip beside it, and five round
 * buttons sit over the bottom: microphone, camera, screen, the people (with «ضيف حدا» and the link inside), leave.
 *
 * The connection favours the voice: adaptive stream and dynacast, simulcast layers, Opus with DTX and RED, so when
 * the network weakens the picture drops first and the sound carries on. A lost connection is retried quietly.
 */

type Phase = "loading" | "connecting" | "in" | "left" | "ended" | "removed" | "denied";

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

export function CallRoom({ callId }: { callId: string }) {
  const toast = useOptionalToast();
  const [view, setView] = React.useState<CallView | null>(null);
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [error, setError] = React.useState("");
  const [panel, setPanel] = React.useState<"none" | "people" | "invite">("none");
  const [reconnecting, setReconnecting] = React.useState(false);
  const [needsAudioTap, setNeedsAudioTap] = React.useState(false);
  const roomRef = React.useRef<Room | null>(null);
  const joining = React.useRef(false);
  // every change in the room (somebody came, a camera went on) draws again
  const [, setTick] = React.useState(0);
  const redraw = React.useCallback(() => setTick((n) => n + 1), []);
  const api = `/api/calls/${encodeURIComponent(callId)}`;

  const say = React.useCallback((text: string, kind: "success" | "error" = "success") => {
    if (toast) toast.toast(text, kind);
    else if (kind === "error") setError(text);
  }, [toast]);

  const load = React.useCallback(async () => {
    try {
      const v = await callApi<CallView>(api);
      setView(v);
      return v;
    } catch (e) {
      setError(e instanceof Error ? e.message : ct("calls.action_failed"));
      setPhase((p) => (p === "loading" ? "denied" : p));
      return null;
    }
  }, [api]);

  const join = React.useCallback(async (video: boolean) => {
    if (joining.current) return;
    joining.current = true;
    setError("");
    setPhase("connecting");
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
    room.on(RoomEvent.ParticipantConnected, () => void load());
    room.on(RoomEvent.Reconnecting, () => setReconnecting(true));
    room.on(RoomEvent.Reconnected, () => setReconnecting(false));
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsAudioTap(!room.canPlaybackAudio));
    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (roomRef.current !== room) return;
      roomRef.current = null;
      setReconnecting(false);
      setPhase(reason === DisconnectReason.PARTICIPANT_REMOVED ? "removed" : "left");
    });
    try {
      let pass: { url: string; token: string };
      try {
        pass = await callApi<{ url: string; token: string }>(`${api}/token`, {});
      } catch (e) {
        // the server's refusal, already in Arabic (ended, not yours, no calls server)
        setPhase("denied");
        setError(e instanceof Error ? e.message : ct("calls.failed"));
        return;
      }
      try {
        await room.connect(pass.url, pass.token);
      } catch {
        // the calls server's own words are English: the person reads ours
        setPhase("denied");
        setError(ct("calls.failed"));
        void room.disconnect();
        return;
      }
      roomRef.current = room;
      setPhase("in");
      setNeedsAudioTap(!room.canPlaybackAudio);
      void load();
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        if (video) await room.localParticipant.setCameraEnabled(true);
      } catch {
        // no permission, or no device: the person is in and hears everybody; the buttons ask again
        say(ct("calls.no_media"), "error");
      }
      redraw();
    } finally {
      joining.current = false;
    }
  }, [api, load, redraw, say]);

  // opening the page is joining: no screen in between (a tap on «مكالمة» or «ردّ» brought the person here)
  React.useEffect(() => {
    void load().then((v) => {
      if (!v) return;
      if (v.endedAt) setPhase("ended");
      else void join(v.video);
    });
  }, [load, join]);

  // leaving the page leaves the room
  React.useEffect(() => () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) void room.disconnect().then(() => fetch(`${api}/leave`, { method: "POST", keepalive: true }), () => undefined);
  }, [api]);

  // the people list (who may be taken out) follows the room
  React.useEffect(() => {
    if (phase !== "in") return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [phase, load]);

  async function toggle(what: "mic" | "cam" | "screen") {
    const room = roomRef.current;
    if (!room) return;
    const me = room.localParticipant;
    try {
      if (what === "mic") await me.setMicrophoneEnabled(!me.isMicrophoneEnabled);
      else if (what === "cam") await me.setCameraEnabled(!me.isCameraEnabled);
      else await me.setScreenShareEnabled(!me.isScreenShareEnabled, { audio: true, contentHint: "detail" });
    } catch {
      if (what !== "screen") say(ct("calls.no_media"), "error");
    }
    redraw();
  }

  async function leave() {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.disconnect();
    await fetch(`${api}/leave`, { method: "POST" }).catch(() => undefined);
    setPhase("left");
  }

  async function removePerson(userId: string) {
    try {
      await callApi(`${api}/remove`, { userId });
      say(ct("calls.removed_ok"));
      void load();
    } catch (e) {
      say(e instanceof Error ? e.message : ct("calls.action_failed"), "error");
    }
  }

  function copyLink() {
    if (!view) return;
    void navigator.clipboard?.writeText(`${window.location.origin}${view.path}`).then(() => say(ct("calls.link_copied")), () => say(ct("calls.action_failed"), "error"));
  }

  const back = view?.conversationId ? `/chat/${view.conversationId}` : "/chat";
  const title = view?.title || view?.conversationTitle || ct("calls.page_title");

  if (phase === "loading" || phase === "left" || phase === "ended" || phase === "removed" || phase === "denied") {
    const line =
      phase === "ended" ? ct("calls.ended") : phase === "removed" ? ct("calls.removed_me") : phase === "left" ? ct("calls.left") : phase === "denied" ? error : ct("calls.connecting");
    return (
      <section dir="rtl" lang="ar" className="mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center" aria-label={title}>
        <h1 className="text-xl font-bold">{title}</h1>
        <p role="status">{line}</p>
        {(phase === "left" || phase === "denied") && view && !view.endedAt && (
          <button type="button" onClick={() => void join(false)} className="min-h-11 rounded-full bg-ok px-6 font-semibold text-ok-fg">
            {ct("calls.again")}
          </button>
        )}
        <Link href={back} className="min-h-11 rounded-lg px-4 py-2 text-accent hover:bg-surface-2">
          {ct("calls.back")}
        </Link>
      </section>
    );
  }

  const room = roomRef.current;
  const me = room?.localParticipant;
  const everyone: Participant[] = room ? [room.localParticipant, ...room.remoteParticipants.values()] : [];
  const sharer = everyone.find((p) => p.isScreenShareEnabled && p.getTrackPublication(Track.Source.ScreenShare)?.track);
  const sounds = everyone
    .filter((p) => p !== me)
    .flatMap((p) => [p.getTrackPublication(Track.Source.Microphone)?.track, p.getTrackPublication(Track.Source.ScreenShareAudio)?.track])
    .filter((t): t is LkTrack => !!t);

  return (
    // the call takes the whole screen, over the app's bars (toasts stay above it)
    <section dir="rtl" lang="ar" className="fixed inset-0 z-[60] flex flex-col bg-surface text-fg" aria-label={title}>
      <header className="flex items-center gap-2 px-3 pb-1 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold">{title}</h1>
          <p className="text-xs text-fg-muted">{phase === "connecting" ? ct("calls.connecting") : ctCount("calls.count", everyone.length)}</p>
        </div>
        {reconnecting && <p role="status" className="rounded-full bg-warn/15 px-3 py-1 text-xs text-warn">{ct("calls.reconnecting")}</p>}
      </header>

      {sharer ? (
        <Stage sharer={sharer} everyone={everyone} me={me} />
      ) : (
        <Tiles everyone={everyone} me={me} />
      )}

      {needsAudioTap && (
        <button type="button" onClick={() => void room?.startAudio().then(() => setNeedsAudioTap(false))} className="absolute inset-x-0 top-16 mx-auto w-fit rounded-full bg-accent px-5 py-3 font-semibold text-accent-fg shadow-lg">
          {ct("calls.start_audio")}
        </button>
      )}

      {panel !== "none" && view && (
        <aside className="absolute inset-x-2 bottom-24 z-10 max-h-[60%] overflow-y-auto rounded-2xl border border-border bg-surface-1 p-3 shadow-lg sm:inset-x-auto sm:end-3 sm:w-80">
          {panel === "people" ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="flex-1 font-semibold">{ct("calls.people")}</h2>
                <button type="button" onClick={copyLink} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm hover:bg-surface-2">
                  <span aria-hidden="true">🔗</span>
                  {ct("calls.copy_link")}
                </button>
              </div>
              <ul className="flex flex-col gap-1">
                {everyone.map((p) => {
                  const row = view.people.find((x) => x.userId === p.identity);
                  return (
                    <li key={p.identity} className="flex min-h-11 items-center gap-2">
                      <Avatar name={p.name || p.identity} className="h-8 w-8" />
                      <span className="min-w-0 flex-1 truncate">{nameOf(p, me)}</span>
                      <Quality quality={p.connectionQuality} />
                      {row?.canRemove && (
                        <button type="button" onClick={() => void removePerson(p.identity)} className="min-h-11 rounded-lg px-2 text-sm text-danger hover:bg-danger/10">
                          {ct("calls.remove")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {view.can.invite && (
                <button type="button" onClick={() => setPanel("invite")} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-border text-sm hover:bg-surface-2">
                  <span aria-hidden="true">➕</span>
                  {ct("calls.invite")}
                </button>
              )}
            </>
          ) : (
            <CallInvite callId={callId} inCall={everyone.map((p) => p.identity)} onDone={(name) => say(ct("calls.invited", { name }))} onError={(text) => say(text, "error")} />
          )}
        </aside>
      )}

      {sounds.map((t) => (
        <AudioOut key={t.sid} track={t} />
      ))}

      <nav aria-label={ct("calls.controls")} className="flex items-center justify-center gap-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <Round on={!!me?.isMicrophoneEnabled} onClick={() => void toggle("mic")} label={me?.isMicrophoneEnabled ? ct("calls.mic_off") : ct("calls.mic_on")} icon={me?.isMicrophoneEnabled ? "🎙️" : "🔇"} />
        <Round on={!!me?.isCameraEnabled} onClick={() => void toggle("cam")} label={me?.isCameraEnabled ? ct("calls.cam_off") : ct("calls.cam_on")} icon={me?.isCameraEnabled ? "🎥" : "📷"} />
        {canShareScreen() && (
          <Round on={!!me?.isScreenShareEnabled} onClick={() => void toggle("screen")} label={me?.isScreenShareEnabled ? ct("calls.screen_stop") : ct("calls.screen_start")} icon="🖥️" />
        )}
        <Round on={panel !== "none"} onClick={() => setPanel((v) => (v === "none" ? "people" : "none"))} label={ct("calls.people")} icon="👥" />
        <button type="button" onClick={() => void leave()} aria-label={ct("calls.leave")} title={ct("calls.leave")} className="inline-flex h-12 min-w-12 items-center justify-center gap-1 rounded-full bg-danger px-4 font-semibold text-danger-fg">
          <span aria-hidden="true">📴</span>
          <span className="max-sm:sr-only">{ct("calls.leave")}</span>
        </button>
      </nav>
    </section>
  );
}

/** Everybody's picture, sharing the room by count and by the shape of the screen. */
function Tiles({ everyone, me }: { everyone: Participant[]; me: Participant | undefined }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const grid = bestGrid(everyone.length, size.width, size.height);
  return (
    <div ref={ref} className="min-h-0 flex-1 px-2">
      <ul
        className="grid h-full w-full gap-2"
        style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))` }}
      >
        {everyone.map((p) => (
          <Tile key={p.identity} p={p} me={me} />
        ))}
      </ul>
    </div>
  );
}

/** A shared screen is the stage; the people sit in a strip beside it (sideways) or under it (upright). */
function Stage({ sharer, everyone, me }: { sharer: Participant; everyone: Participant[]; me: Participant | undefined }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const sideways = size.width > size.height;
  return (
    <div ref={ref} className={`flex min-h-0 flex-1 gap-2 px-2 ${sideways ? "flex-row" : "flex-col"}`}>
      <figure className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-scrim">
        <TrackView track={sharer.getTrackPublication(Track.Source.ScreenShare)?.track} fit="contain" className="h-full w-full" />
        <figcaption className="absolute bottom-2 start-2 rounded bg-scrim/70 px-2 text-xs text-on-photo">{ct("calls.screen_of", { name: nameOf(sharer, me) })}</figcaption>
      </figure>
      <ul className={`flex shrink-0 gap-2 overflow-auto ${sideways ? "w-40 flex-col" : "h-24 flex-row"}`}>
        {everyone.map((p) => (
          <li key={p.identity} className={sideways ? "aspect-video w-full shrink-0" : "aspect-video h-full shrink-0"}>
            <ul className="h-full">
              <Tile p={p} me={me} small />
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tile({ p, me, small = false }: { p: Participant; me: Participant | undefined; small?: boolean }) {
  return (
    <li className={`relative h-full min-h-0 overflow-hidden rounded-xl bg-surface-2 ${p.isSpeaking ? "ring-2 ring-ok" : ""}`}>
      {p.isCameraEnabled ? (
        <TrackView track={p.getTrackPublication(Track.Source.Camera)?.track} fit="cover" className="h-full w-full" mirror={p === me} />
      ) : (
        <div className="flex h-full items-center justify-center">
          <Avatar name={p.name || p.identity} className={small ? "h-9 w-9" : "h-16 w-16 text-lg"} />
        </div>
      )}
      <span className="absolute bottom-1.5 start-1.5 flex max-w-[90%] items-center gap-1 truncate rounded bg-scrim/70 px-2 text-xs text-on-photo">
        {!p.isMicrophoneEnabled && <span aria-label={ct("calls.muted")}>🔇</span>}
        {nameOf(p, me)}
        {!small && <Quality quality={p.connectionQuality} />}
      </span>
    </li>
  );
}

/** Three bars: how good this person's line is right now. */
function Quality({ quality }: { quality: ConnectionQuality }) {
  const level = quality === ConnectionQuality.Excellent ? 3 : quality === ConnectionQuality.Good ? 2 : quality === ConnectionQuality.Poor ? 1 : 0;
  if (quality === ConnectionQuality.Unknown) return null;
  const tone = level >= 2 ? "bg-ok" : level === 1 ? "bg-warn" : "bg-danger";
  return (
    <span role="img" aria-label={ct(`calls.quality.${quality}`)} title={ct(`calls.quality.${quality}`)} className="inline-flex h-3 items-end gap-px">
      {[1, 2, 3].map((bar) => (
        <span key={bar} className={`w-[3px] rounded-sm ${bar <= level ? tone : "bg-fg-muted/40"}`} style={{ height: `${bar * 33}%` }} />
      ))}
    </span>
  );
}

function nameOf(p: Participant, me: Participant | undefined): string {
  return p === me ? ct("calls.you") : p.name || p.identity;
}

/** Screen sharing exists on a computer's browser; a phone's browser has none. */
function canShareScreen(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function";
}

function useSize(ref: React.RefObject<HTMLElement>): { width: number; height: number } {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    read();
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref]);
  return size;
}

/** A round button of the call: the icon always, its word beside it on a wide screen and for screen readers. */
function Round({ on, onClick, label, icon }: { on: boolean; onClick: () => void; label: string; icon: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`inline-flex h-12 min-w-12 items-center justify-center gap-1 rounded-full border px-3 text-sm ${on ? "border-accent bg-accent/15 text-fg" : "border-border bg-surface-1 hover:bg-surface-2"}`}
    >
      <span aria-hidden="true" className="text-lg">{icon}</span>
      <span className="max-lg:sr-only">{label}</span>
    </button>
  );
}

/** A camera or a screen, drawn into a <video> for as long as it is on the page. */
function TrackView({ track, fit, className, mirror = false }: { track: LkTrack | undefined; fit: "cover" | "contain"; className?: string; mirror?: boolean }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className={`${className ?? ""} ${fit === "cover" ? "object-cover" : "object-contain"} ${mirror ? "-scale-x-100" : ""}`} />;
}

/** Somebody's voice (or the sound of their shared screen), played for as long as it is on the page. */
function AudioOut({ track }: { track: LkTrack }) {
  const ref = React.useRef<HTMLAudioElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}
