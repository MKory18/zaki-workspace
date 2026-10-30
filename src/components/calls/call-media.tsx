"use client";

import React from "react";
import { ConnectionQuality, Track, type Participant, type Track as LkTrack } from "livekit-client";
import { ct } from "@/lib/chat/text";
import { Avatar } from "@/components/ui/avatar";

/** The pieces the call page and the small call window both draw. */

export function nameOf(p: Participant, me: Participant | undefined): string {
  return p === me ? ct("calls.you") : p.name || p.identity;
}

/** The picture a small window shows: a shared screen first, then whoever speaks, then anybody else with a camera. */
export function mainPicture(everyone: Participant[], me: Participant | undefined): { p: Participant; source: Track.Source } | null {
  const screen = everyone.find((p) => p.isScreenShareEnabled && p.getTrackPublication(Track.Source.ScreenShare)?.track);
  if (screen) return { p: screen, source: Track.Source.ScreenShare };
  const others = everyone.filter((p) => p !== me);
  const speaking = others.find((p) => p.isSpeaking && p.isCameraEnabled);
  if (speaking) return { p: speaking, source: Track.Source.Camera };
  const withCamera = others.find((p) => p.isCameraEnabled) ?? (me?.isCameraEnabled ? me : undefined);
  if (withCamera) return { p: withCamera, source: Track.Source.Camera };
  const first = others[0] ?? me;
  return first ? { p: first, source: Track.Source.Camera } : null;
}

/** A camera or a screen, drawn into a <video> for as long as it is on the page. */
export const TrackView = React.forwardRef<
  HTMLVideoElement,
  { track: LkTrack | undefined; fit: "cover" | "contain"; className?: string; mirror?: boolean }
>(function TrackView({ track, fit, className, mirror = false }, outer) {
  const ref = React.useRef<HTMLVideoElement | null>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <video
      ref={(el) => {
        ref.current = el;
        if (typeof outer === "function") outer(el);
        else if (outer) outer.current = el;
      }}
      autoPlay
      playsInline
      muted
      className={`${className ?? ""} ${fit === "cover" ? "object-cover" : "object-contain"} ${mirror ? "-scale-x-100" : ""}`}
    />
  );
});

/** Somebody's voice (or the sound of their shared screen), played for as long as the call is on. */
export function AudioOut({ track }: { track: LkTrack }) {
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

/** Three bars: how good this person's line is right now. */
export function Quality({ quality }: { quality: ConnectionQuality }) {
  if (quality === ConnectionQuality.Unknown) return null;
  const level = quality === ConnectionQuality.Excellent ? 3 : quality === ConnectionQuality.Good ? 2 : quality === ConnectionQuality.Poor ? 1 : 0;
  const tone = level >= 2 ? "bg-ok" : level === 1 ? "bg-warn" : "bg-danger";
  return (
    <span role="img" aria-label={ct(`calls.quality.${quality}`)} title={ct(`calls.quality.${quality}`)} className="inline-flex h-3 items-end gap-px">
      {[1, 2, 3].map((bar) => (
        <span key={bar} className={`w-[3px] rounded-sm ${bar <= level ? tone : "bg-fg-muted/40"}`} style={{ height: `${bar * 33}%` }} />
      ))}
    </span>
  );
}

export function PersonPicture({ p, me, src, source = Track.Source.Camera, fit = "cover", className, small = false }: {
  p: Participant;
  me: Participant | undefined;
  /** `/api/avatars/<id>` of this person, when the caller knows it */
  src?: string | null;
  source?: Track.Source;
  fit?: "cover" | "contain";
  className?: string;
  small?: boolean;
}) {
  const on = source === Track.Source.ScreenShare ? p.isScreenShareEnabled : p.isCameraEnabled;
  if (on) return <TrackView track={p.getTrackPublication(source)?.track} fit={fit} className={className ?? "h-full w-full"} mirror={p === me && source === Track.Source.Camera} />;
  return (
    <div className="flex h-full items-center justify-center">
      <Avatar name={p.name || p.identity} src={src} className={small ? "h-9 w-9" : "h-16 w-16 text-lg"} />
    </div>
  );
}
