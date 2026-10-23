"use client";

import { useEffect, useRef, useState } from "react";
import { ART_AVAILABLE, artStateOf, artUrl, isArtSlot, type ArtSlotName, type ArtState } from "@/lib/themes/decor";
import { cn } from "@/lib/utils";

/**
 * A SLOT FOR THE OWNER'S ARTWORK — which arrives later.
 *
 * Renders `/brand/art/<slot>.webp` (the twelve agreed names are `ART_SLOTS` in `src/lib/themes/decor.ts`: the
 * login door, the Today strip, the empty-list drawings, the guide drawings). Until the file exists the page
 * shows NOTHING broken: the image removes itself the moment the browser says it failed, and the CSS ornament
 * (the decoration layer) is what the page shows meanwhile. When the owner drops a file with the agreed name into
 * `public/brand/art/`, it is picked up with no code change.
 *
 * It is decoration (`alt=""`, lazy, decoded off the main thread). `data-state` is `loading`, then `loaded`; the
 * stylesheet uses it to fade the picture in and, for the login door, to put the text column on a scrim panel only
 * once there is a picture behind it. A name that is not an agreed slot renders nothing at all (it goes into a URL).
 *
 * Do not reserve space for it (a fixed height or an aspect ratio) unless something else fills that space when the
 * picture is missing: a missing file would leave a hole. Size it with `max-h-*` / `max-w-*` so it collapses.
 */
export function ArtSlot({ slot, className }: { slot: string; className?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<ArtState>("loading");

  useEffect(() => {
    // The server's <img> may have failed (or finished) before React attached its listeners: that event is not replayed.
    const now = artStateOf(ref.current);
    if (now !== "loading") setState(now);
  }, []);

  // WP-UI2 item 5: nothing is drawn while the owner's file is not on disk — no request to a missing
  // `/brand/art/<slot>.webp`, no broken image, no flash; the CSS ornament layer is the decoration until
  // then. `ART_AVAILABLE` is the list of files actually shipped in this build.
  if (!ART_AVAILABLE.includes(slot as ArtSlotName)) return null;

  if (!isArtSlot(slot) || state === "failed") return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={artUrl(slot)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      data-art-slot={slot}
      data-state={state}
      className={cn("zk-art", className)}
      onError={() => setState("failed")}
      onLoad={() => setState("loaded")}
    />
  );
}
