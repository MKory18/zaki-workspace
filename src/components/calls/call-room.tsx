"use client";

import React from "react";
import Link from "next/link";
import { Track, type Participant } from "livekit-client";
import { ct, ctCount } from "@/lib/chat/text";
import { bestGrid } from "@/lib/calls/layout";
import { Avatar } from "@/components/ui/avatar";
import { useOptionalToast } from "@/components/ui/toast";
import { callApi, type CallView } from "./call-api";
import { CallInvite } from "./call-invite";
import { nameOf, PersonPicture, Quality } from "./call-media";
import { useOptionalCall, type CallApi } from "./call-provider";

/**
 * The page of one call, as simple as a phone call (the owner's bar: «السلاسة وعدم التعقيد ولا الخطوات الزائدة»):
 * opening it joins at once — the microphone on, the camera as the call was started — with no screen in between.
 * The call itself lives in the call keeper (call-provider.tsx): leaving this page keeps it going in a small window,
 * coming back picks it up where it was. Only «اطلع» ends it for the person.
 *
 * The call takes the whole screen (the app's bars step aside), the pictures share it by size and orientation
 * (src/lib/calls/layout.ts), a shared screen becomes the stage with the people in a strip beside it, and five round
 * buttons sit over the bottom: microphone, camera, screen, the people (with «ضيف حدا» and the link inside), leave.
 */
export function CallRoom({ callId }: { callId: string }) {
  const call = useOptionalCall();
  // drawn on its own (outside the app's frame, where the call keeper lives): only the page's name
  if (!call) {
    return (
      <section dir="rtl" lang="ar" className="mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center" aria-label={ct("calls.page_title")}>
        <h1 className="text-xl font-bold">{ct("calls.page_title")}</h1>
        <p role="status">{ct("calls.connecting")}</p>
      </section>
    );
  }
  return <CallScreen callId={callId} call={call} />;
}

function CallScreen({ callId, call }: { callId: string; call: CallApi }) {
  const toast = useOptionalToast();
  const [view, setView] = React.useState<CallView | null>(null);
  const [loadError, setLoadError] = React.useState("");
  const [panel, setPanel] = React.useState<"none" | "people" | "invite">("none");
  const api = `/api/calls/${encodeURIComponent(callId)}`;
  const mine = call.state.callId === callId;
  const phase = mine ? call.state.phase : "idle";

  const say = React.useCallback((text: string, kind: "success" | "error" = "success") => {
    if (toast) toast.toast(text, kind);
  }, [toast]);

  const load = React.useCallback(async () => {
    try {
      const v = await callApi<CallView>(api);
      setView(v);
      return v;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : ct("calls.action_failed"));
      return null;
    }
  }, [api]);

  // opening the page is joining: no screen in between (a tap on «مكالمة» or «ردّ» brought the person here); coming
  // back to a call that is already on picks it up (join does nothing then)
  const { join } = call;
  const joinRef = React.useRef(join);
  joinRef.current = join;
  React.useEffect(() => {
    void load().then((v) => {
      if (v && !v.endedAt) void joinRef.current(callId, v.video);
    });
  }, [load, callId]);

  // the people list (who may be taken out) follows the room
  React.useEffect(() => {
    if (phase !== "in") return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [phase, load]);
  const count = call.everyone.length;
  React.useEffect(() => {
    if (phase === "in") void load();
  }, [count, phase, load]);

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
  const ended = !!view?.endedAt;

  if (loadError || ended || (phase !== "in" && phase !== "connecting" && phase !== "lost")) {
    const line = loadError
      ? loadError
      : ended || phase === "ended"
        ? ct("calls.ended")
        : phase === "removed"
          ? ct("calls.removed_me")
          : phase === "left"
            ? ct("calls.left")
            : phase === "denied"
              ? call.state.error
              : ct("calls.connecting");
    const canRejoin = !loadError && !ended && (phase === "left" || phase === "denied");
    return (
      <section dir="rtl" lang="ar" className="mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center" aria-label={title}>
        <h1 className="text-xl font-bold">{title}</h1>
        <p role="status">{line}</p>
        {canRejoin && view && (
          <button type="button" onClick={() => void join(callId, false)} className="min-h-11 rounded-full bg-ok px-6 font-semibold text-ok-fg">
            {ct("calls.again")}
          </button>
        )}
        <Link href={back} className="min-h-11 rounded-lg px-4 py-2 text-accent hover:bg-surface-2">
          {ct("calls.back")}
        </Link>
      </section>
    );
  }

  const me = call.room?.localParticipant;
  const everyone = call.everyone;
  const sharer = everyone.find((p) => p.isScreenShareEnabled && p.getTrackPublication(Track.Source.ScreenShare)?.track);

  return (
    // the call takes the whole screen, over the app's bars (toasts stay above it)
    <section dir="rtl" lang="ar" className="fixed inset-0 z-[60] flex flex-col bg-surface text-fg" aria-label={title}>
      <header className="flex items-center gap-2 px-3 pb-1 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Link href={back} aria-label={ct("calls.minimize")} title={ct("calls.minimize")} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2">
          <span aria-hidden="true">⌄</span>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold">{title}</h1>
          <p className="text-xs text-fg-muted">{phase === "in" ? ctCount("calls.count", everyone.length) : ct("calls.connecting")}</p>
        </div>
        {(call.state.reconnecting || phase === "lost") && <p role="status" className="rounded-full bg-warn/15 px-3 py-1 text-xs text-warn">{ct("calls.reconnecting")}</p>}
      </header>

      {sharer ? <Stage sharer={sharer} everyone={everyone} me={me} /> : <Tiles everyone={everyone} me={me} />}

      {call.state.needsAudioTap && (
        <button type="button" onClick={() => void call.startAudio()} className="absolute inset-x-0 top-16 mx-auto w-fit rounded-full bg-accent px-5 py-3 font-semibold text-accent-fg shadow-lg">
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

      <nav aria-label={ct("calls.controls")} className="flex items-center justify-center gap-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <Round on={!!me?.isMicrophoneEnabled} onClick={() => void call.toggle("mic")} label={me?.isMicrophoneEnabled ? ct("calls.mic_off") : ct("calls.mic_on")} icon={me?.isMicrophoneEnabled ? "🎙️" : "🔇"} />
        <Round on={!!me?.isCameraEnabled} onClick={() => void call.toggle("cam")} label={me?.isCameraEnabled ? ct("calls.cam_off") : ct("calls.cam_on")} icon={me?.isCameraEnabled ? "🎥" : "📷"} />
        {canShareScreen() && (
          <Round on={!!me?.isScreenShareEnabled} onClick={() => void call.toggle("screen")} label={me?.isScreenShareEnabled ? ct("calls.screen_stop") : ct("calls.screen_start")} icon="🖥️" />
        )}
        <Round on={panel !== "none"} onClick={() => setPanel((v) => (v === "none" ? "people" : "none"))} label={ct("calls.people")} icon="👥" />
        <button type="button" onClick={() => void call.leave()} aria-label={ct("calls.leave")} title={ct("calls.leave")} className="inline-flex h-12 min-w-12 items-center justify-center gap-1 rounded-full bg-danger px-4 font-semibold text-danger-fg">
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
        <PersonPicture p={sharer} me={me} source={Track.Source.ScreenShare} fit="contain" />
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
      <PersonPicture p={p} me={me} small={small} />
      <span className="absolute bottom-1.5 start-1.5 flex max-w-[90%] items-center gap-1 truncate rounded bg-scrim/70 px-2 text-xs text-on-photo">
        {!p.isMicrophoneEnabled && <span aria-label={ct("calls.muted")}>🔇</span>}
        {nameOf(p, me)}
        {!small && <Quality quality={p.connectionQuality} />}
      </span>
    </li>
  );
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
