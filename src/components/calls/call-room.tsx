"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DisconnectReason, Room, RoomEvent, Track, type Participant, type Track as LkTrack } from "livekit-client";
import { ct, ctCount } from "@/lib/chat/text";
import { Avatar } from "@/components/ui/avatar";
import { useOptionalToast } from "@/components/ui/toast";
import { callApi, type CallView } from "./call-api";
import { CallInvite } from "./call-invite";

/**
 * The page of one call. First a short lobby (the microphone and the camera, and a tap: browsers play sound only
 * after one), then the room on the company's calls server: everybody's picture or initials, a shared screen
 * large on top, and the bar — microphone, camera, screen, «ضيف حدا», the people (with «طلّعه» for whoever may),
 * the link, «اطلع». The pass comes from POST /api/calls/[id]/token, only for somebody who may join.
 */

type Phase = "loading" | "lobby" | "connecting" | "in" | "left" | "ended" | "removed" | "denied";

export function CallRoom({ callId }: { callId: string }) {
  const router = useRouter();
  const toast = useOptionalToast();
  const [view, setView] = React.useState<CallView | null>(null);
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [error, setError] = React.useState("");
  const [mic, setMic] = React.useState(true);
  const [cam, setCam] = React.useState(false);
  const [panel, setPanel] = React.useState<"none" | "people" | "invite">("none");
  const roomRef = React.useRef<Room | null>(null);
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

  React.useEffect(() => {
    void load().then((v) => {
      if (!v) return;
      setCam(v.video);
      setPhase(v.endedAt ? "ended" : "lobby");
    });
  }, [load]);

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

  async function join() {
    setError("");
    setPhase("connecting");
    const room = new Room({ adaptiveStream: true, dynacast: true });
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
    ]) {
      room.on(ev, redraw);
    }
    room.on(RoomEvent.ParticipantConnected, () => void load());
    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (roomRef.current !== room) return;
      roomRef.current = null;
      setPhase(reason === DisconnectReason.PARTICIPANT_REMOVED ? "removed" : "left");
    });
    let pass: { url: string; token: string };
    try {
      pass = await callApi<{ url: string; token: string }>(`${api}/token`, {});
    } catch (e) {
      // the server's refusal, already in Arabic (ended, not yours, no calls server)
      setPhase("lobby");
      setError(e instanceof Error ? e.message : ct("calls.failed"));
      return;
    }
    try {
      await room.connect(pass.url, pass.token);
      roomRef.current = room;
      setPhase("in");
      void load();
    } catch {
      // the calls server's own words are English: the person reads ours
      setPhase("lobby");
      setError(ct("calls.failed"));
      void room.disconnect();
      return;
    }
    try {
      await room.localParticipant.setMicrophoneEnabled(mic);
      await room.localParticipant.setCameraEnabled(cam);
    } catch {
      say(ct("calls.no_media"), "error");
    }
    redraw();
  }

  async function toggle(what: "mic" | "cam" | "screen") {
    const room = roomRef.current;
    if (!room) return;
    const me = room.localParticipant;
    try {
      if (what === "mic") await me.setMicrophoneEnabled(!me.isMicrophoneEnabled);
      else if (what === "cam") await me.setCameraEnabled(!me.isCameraEnabled);
      else await me.setScreenShareEnabled(!me.isScreenShareEnabled, { audio: true });
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

  if (phase !== "in" && phase !== "connecting") {
    const line =
      phase === "ended" ? ct("calls.ended") : phase === "removed" ? ct("calls.removed_me") : phase === "left" ? ct("calls.left") : phase === "denied" ? error : "";
    return (
      <section dir="rtl" lang="ar" className="mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center" aria-label={title}>
        <h1 className="text-xl font-bold">{title}</h1>
        {view && <p className="text-sm text-fg-muted">{ct("calls.started_by", { name: view.startedBy.name })}</p>}
        {phase === "loading" && <p className="text-fg-muted">{ct("calls.connecting")}</p>}
        {line && <p role="status">{line}</p>}
        {phase === "lobby" && (
          <div className="flex w-full flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4">
            <p className="font-semibold">{ct("calls.lobby.title")}</p>
            <label className="flex min-h-11 items-center justify-between gap-2">
              <span>{ct("calls.lobby.mic")}</span>
              <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} className="h-5 w-5" />
            </label>
            <label className="flex min-h-11 items-center justify-between gap-2">
              <span>{ct("calls.lobby.camera")}</span>
              <input type="checkbox" checked={cam} onChange={(e) => setCam(e.target.checked)} className="h-5 w-5" />
            </label>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <button type="button" onClick={() => void join()} className="min-h-11 rounded-lg bg-accent px-4 font-semibold text-accent-fg">
              {ct("calls.lobby.join")}
            </button>
          </div>
        )}
        {phase === "left" && view && !view.endedAt && (
          <button type="button" onClick={() => setPhase("lobby")} className="min-h-11 rounded-lg border border-border px-4">
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
  const everyone: Participant[] = room ? [room.localParticipant, ...room.remoteParticipants.values()] : [];
  const screens = everyone.filter((p) => p.isScreenShareEnabled);
  const me = room?.localParticipant;

  return (
    <section dir="rtl" lang="ar" className="flex h-full min-h-0 flex-col bg-surface" aria-label={title}>
      <header className="flex items-center gap-3 border-b border-border p-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-bold">{title}</h1>
          <p className="text-sm text-fg-muted">{phase === "connecting" ? ct("calls.connecting") : ctCount("calls.count", everyone.length)}</p>
        </div>
        <button type="button" onClick={copyLink} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 text-sm hover:bg-surface-2">
          <span aria-hidden="true">🔗</span>
          {ct("calls.copy_link")}
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          {screens.map((p) => (
            <figure key={`s-${p.identity}`} className="relative overflow-hidden rounded-xl border border-border bg-surface-2">
              <TrackView track={p.getTrackPublication(Track.Source.ScreenShare)?.track} fit="contain" className="max-h-[60vh] w-full" />
              <figcaption className="absolute bottom-2 start-2 rounded bg-scrim/70 px-2 text-sm text-on-photo">{ct("calls.screen_of", { name: nameOf(p, me) })}</figcaption>
            </figure>
          ))}
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {everyone.map((p) => (
              <li key={p.identity} className={`relative aspect-video overflow-hidden rounded-xl border bg-surface-2 ${p.isSpeaking ? "border-ok ring-2 ring-ok" : "border-border"}`}>
                {p.isCameraEnabled ? (
                  <TrackView track={p.getTrackPublication(Track.Source.Camera)?.track} fit="cover" className="h-full w-full" mirror={p === me} />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Avatar name={p.name || p.identity} className="h-16 w-16 text-lg" />
                  </div>
                )}
                <span className="absolute bottom-2 start-2 flex items-center gap-1 rounded bg-scrim/70 px-2 text-sm text-on-photo">
                  {!p.isMicrophoneEnabled && <span aria-label={ct("calls.muted")}>🔇</span>}
                  {nameOf(p, me)}
                </span>
              </li>
            ))}
          </ul>
          {everyone
            .filter((p) => p !== me)
            .flatMap((p) => [p.getTrackPublication(Track.Source.Microphone)?.track, p.getTrackPublication(Track.Source.ScreenShareAudio)?.track])
            .filter((t): t is LkTrack => !!t)
            .map((t) => (
              <AudioOut key={t.sid} track={t} />
            ))}
        </div>
        {panel !== "none" && view && (
          <aside className="w-72 shrink-0 overflow-y-auto border-s border-border p-3 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-20 max-sm:top-auto max-sm:z-40 max-sm:max-h-[50vh] max-sm:w-auto max-sm:bg-surface-1">
            {panel === "people" ? (
              <>
                <h2 className="mb-2 font-semibold">{ct("calls.people")}</h2>
                <ul className="flex flex-col gap-1">
                  {everyone.map((p) => {
                    const row = view.people.find((x) => x.userId === p.identity);
                    return (
                      <li key={p.identity} className="flex min-h-11 items-center gap-2">
                        <Avatar name={p.name || p.identity} className="h-8 w-8" />
                        <span className="min-w-0 flex-1 truncate">{nameOf(p, me)}</span>
                        {row?.canRemove && (
                          <button type="button" onClick={() => void removePerson(p.identity)} className="min-h-11 rounded-lg px-2 text-sm text-danger hover:bg-danger/10">
                            {ct("calls.remove")}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <CallInvite callId={callId} inCall={everyone.map((p) => p.identity)} onDone={(name) => say(ct("calls.invited", { name }))} onError={(text) => say(text, "error")} />
            )}
          </aside>
        )}
      </div>
      {error && <p role="alert" className="px-3 text-sm text-danger">{error}</p>}
      <nav aria-label={ct("calls.page_title")} className="flex flex-wrap items-center justify-center gap-2 border-t border-border p-3">
        <Control on={!!me?.isMicrophoneEnabled} onClick={() => void toggle("mic")} label={me?.isMicrophoneEnabled ? ct("calls.mic_off") : ct("calls.mic_on")} icon={me?.isMicrophoneEnabled ? "🎙️" : "🔇"} />
        <Control on={!!me?.isCameraEnabled} onClick={() => void toggle("cam")} label={me?.isCameraEnabled ? ct("calls.cam_off") : ct("calls.cam_on")} icon="🎥" />
        {canShareScreen() && (
          <Control on={!!me?.isScreenShareEnabled} onClick={() => void toggle("screen")} label={me?.isScreenShareEnabled ? ct("calls.screen_stop") : ct("calls.screen_start")} icon="🖥️" />
        )}
        <Control on={panel === "people"} onClick={() => setPanel((v) => (v === "people" ? "none" : "people"))} label={ct("calls.people")} icon="👥" />
        {view?.can.invite && <Control on={panel === "invite"} onClick={() => setPanel((v) => (v === "invite" ? "none" : "invite"))} label={ct("calls.invite")} icon="➕" />}
        <button type="button" onClick={() => void leave().then(() => router.refresh())} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-danger px-5 font-semibold text-danger-fg">
          <span aria-hidden="true">📴</span>
          {ct("calls.leave")}
        </button>
      </nav>
    </section>
  );
}

function nameOf(p: Participant, me: Participant | undefined): string {
  return p === me ? ct("calls.you") : p.name || p.identity;
}

/** Screen sharing exists on a computer's browser; a phone's browser has none. */
function canShareScreen(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function";
}

function Control({ on, onClick, label, icon }: { on: boolean; onClick: () => void; label: string; icon: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-4 text-sm ${on ? "border-accent bg-accent/15 text-fg" : "border-border hover:bg-surface-2"}`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
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
