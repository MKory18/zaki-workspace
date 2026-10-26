"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { ct } from "@/lib/chat/text";
import { Avatar } from "@/components/ui/avatar";
import { callApi, type CallView } from "./call-api";
import { useOptionalCall } from "./call-provider";

/** A ring stops by itself after this long (an unanswered call). */
export const RING_FOR_MS = 30_000;

/**
 * The incoming call, on every page: somebody rang this person (a DM call, a topic call that «رنّ على الكل», or
 * «ضيف حدا»). The event carries ids only; the card asks the calls API, which answers only somebody who may join,
 * and a call that ended rings nobody. «ردّ» opens the call's page; «رفض» or thirty seconds close the card.
 */
export function CallRing() {
  const router = useRouter();
  const pathname = usePathname();
  const [ringing, setRinging] = React.useState<CallView | null>(null);
  const call = useOptionalCall();

  useRealtime((event) => {
    if (event.kind !== "call.ring" || !event.callId) return;
    if (pathname === `/calls/${event.callId}`) return; // already in it
    void callApi<CallView>(`/api/calls/${encodeURIComponent(event.callId)}`).then(
      (view) => {
        if (!view.endedAt) {
          setRinging(view);
          // warm the connection while it rings, so «ردّ» is instant
          call?.prefetch(view.id);
        }
      },
      () => undefined,
    );
  });

  React.useEffect(() => {
    if (!ringing) return;
    const stop = setTimeout(() => setRinging(null), RING_FOR_MS);
    const tone = startTone();
    return () => {
      clearTimeout(stop);
      tone();
    };
  }, [ringing]);

  if (!ringing) return null;
  const where = ringing.conversationTitle || ringing.title;
  return (
    <div role="alertdialog" aria-live="assertive" aria-label={ct("calls.ring.from", { name: ringing.startedBy.name })} dir="rtl" lang="ar" className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-sm items-center gap-3 rounded-2xl border border-border bg-surface-1 p-3 shadow-lg">
      <Avatar name={ringing.startedBy.name} className="h-11 w-11" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{ct("calls.ring.from", { name: ringing.startedBy.name })}</p>
        <p className="truncate text-sm text-fg-muted">
          {ringing.video ? ct("calls.video") : ct("calls.audio")}
          {where ? ` ${ct("calls.ring.in", { title: where })}` : ""}
        </p>
      </div>
      <button type="button" onClick={() => setRinging(null)} className="min-h-11 rounded-full border border-border px-3 text-sm hover:bg-surface-2">
        {ct("calls.ring.decline")}
      </button>
      <button
        type="button"
        onClick={() => {
          const id = ringing.id;
          setRinging(null);
          router.push(`/calls/${encodeURIComponent(id)}`);
        }}
        className="min-h-11 rounded-full bg-ok px-4 text-sm font-semibold text-ok-fg"
      >
        {ct("calls.ring.answer")}
      </button>
    </div>
  );
}

/** A soft two-beat ring drawn by the browser itself (no sound file); returns its stop. */
function startTone(): () => void {
  const Ctx = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctx) return () => undefined;
  let ctx: AudioContext | null = null;
  try {
    ctx = new Ctx();
  } catch {
    return () => undefined;
  }
  const audio = ctx;
  const beep = () => {
    for (const at of [0, 0.4]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 480;
      gain.gain.setValueAtTime(0.0001, audio.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.15, audio.currentTime + at + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + 0.3);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + at);
      osc.stop(audio.currentTime + at + 0.32);
    }
  };
  beep();
  const timer = setInterval(beep, 2500);
  return () => {
    clearInterval(timer);
    void audio.close().catch(() => undefined);
  };
}
