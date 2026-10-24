"use client";
import React from "react";
import { AR } from "@/lib/i18n/dict";
import { barsFor, formatDuration } from "@/lib/chat/waveform";

const BARS = 32;

/**
 * The voice note in a bubble: play / pause, the stored waveform (`peaks`) drawn as bars that fill as
 * it plays, and the time (the total until it starts, then what is left). The real `<audio>` stays in
 * the page for the browser's own controls of the media session; it is not shown.
 */
export function VoicePlayer({ src, peaks = [], durationMs = 0 }: { src: string; peaks?: number[]; durationMs?: number }) {
 const audio = React.useRef<HTMLAudioElement | null>(null);
 const [playing, setPlaying] = React.useState(false);
 const [at, setAt] = React.useState(0); // 0..1
 const [total, setTotal] = React.useState(durationMs);
 const bars = barsFor(peaks, BARS);
 const toggle = () => {
  const el = audio.current;
  if (!el) return;
  if (el.paused) void el.play().catch(() => setPlaying(false));
  else el.pause();
 };
 const left = playing || at > 0 ? total * (1 - at) : total;
 const label = AR["chat.f.voice_label"] ?? "";
 return (
  <div data-voice className="mt-1 flex min-w-48 items-center gap-2" role="group" aria-label={`${label} ${formatDuration(total)}`}>
   <button
    type="button"
    onClick={toggle}
    aria-label={playing ? AR["chat.f.pause"] : AR["chat.f.play"]}
    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg"
   >
    <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
   </button>
   <div aria-hidden="true" className="flex h-8 flex-1 items-center gap-px" dir="ltr">
    {bars.map((p, i) => (
     <span
      key={i}
      className={`w-1 rounded-full ${i / BARS < at ? "bg-accent" : "bg-fg-muted/40"}`}
      style={{ height: `${Math.max(12, p)}%` }}
     />
    ))}
   </div>
   <span className="w-11 shrink-0 text-xs tabular-nums text-fg-muted" dir="ltr">{formatDuration(left)}</span>
   <audio
    ref={audio}
    src={src}
    preload="metadata"
    className="hidden"
    onPlay={() => setPlaying(true)}
    onPause={() => setPlaying(false)}
    onEnded={() => { setPlaying(false); setAt(0); }}
    onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setTotal(Math.round(d * 1000)); }}
    onTimeUpdate={(e) => { const el = e.currentTarget; if (Number.isFinite(el.duration) && el.duration > 0) setAt(el.currentTime / el.duration); }}
   />
  </div>
 );
}
