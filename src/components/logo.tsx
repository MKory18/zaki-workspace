"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { AR } from "@/lib/i18n/dict";

/**
 * The mark of Zaki Workspace: the «Z» of the name, drawn as one bold stroke (a top bar, a diagonal and a
 * bottom bar: a path that leads across), with the eight-pointed star of the identity above its corner.
 * It is drawn in code, so it stays sharp at every size; `src/app/icon.svg` carries the same shapes for the
 * favicon and the app icons (scripts/make-icons.mjs).
 */
export function ZakiMark({ className }: { className?: string }) {
  // every mark has its own gradient id: two marks on a page (phone top bar and side menu) must not share one,
  // or a browser paints both with the first (a gradient inside a hidden part of the page paints nothing)
  const gradientId = `zk-z-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label={AR["app.name"]} className={className}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#0E4C66" />
          <stop offset="1" stopColor="#17A5BF" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#${gradientId})`} points="16,26 76,26 76,38 44,70 78,70 78,82 16,82 16,70 48,38 16,38" />
      <polygon fill="#4FC2D8" opacity="0.9" points="16,26 76,26 70,32 16,32" />
      <g fill="#E3B04B">
        <rect x="73" y="7" width="14" height="14" transform="rotate(0 80 14)" />
        <rect x="73" y="7" width="14" height="14" transform="rotate(45 80 14)" />
      </g>
    </svg>
  );
}

/**
 * Sidebar/login logo: the «Z» mark + the product name. The name on screen is «Zaki Workspace»
 * (the owner's decision); the old «Zakai.io / Intelligent Systems» lock-up, with its English tagline,
 * is gone.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <ZakiMark className="size-8 shrink-0" />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="text-sm font-bold tracking-tight text-fg">{AR["app.name"]}</span>
      </span>
    </span>
  );
}
