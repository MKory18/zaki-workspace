"use client";

import { useEffect } from "react";
import { watchDecorVisibility } from "@/lib/themes/decor";

/**
 * Stops the slow motion of the `full` decoration level while nobody is looking.
 *
 * A CSS animation in a hidden tab can still composite on some platforms, and «some platforms» means a phone with
 * eleven tabs open. While the tab is hidden <html> carries `data-decor-hidden`, and one rule of `decor.css`
 * pauses every layer on it. It renders nothing; every layer mounts one, and `watchDecorVisibility` makes them
 * share a single listener (the last one to unmount removes it).
 */
export function DecorVisibility(): null {
  useEffect(() => watchDecorVisibility(document), []);
  return null;
}
