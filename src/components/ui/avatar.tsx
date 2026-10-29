import React from "react";
import { avatarHue, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The person's circle: their picture when they uploaded one, their initials otherwise (with a
 * deterministic per-name hue). Only our own address is ever drawn (`/api/avatars/…`), never a
 * remote URL: a face that a colleague sees is a face this server holds.
 */
export function Avatar({
  name,
  src,
  className,
}: {
  name: string;
  /** `/api/avatars/<id>?v=<file>` — null (or absent) draws the initials */
  src?: string | null;
  className?: string;
}) {
  const safe = src && src.startsWith("/api/avatars/") ? src : null;
  if (safe) {
    return (
      <span
        aria-hidden="true"
        className={cn("relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2", className)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- our own small circle, already sized by CSS; next/image would need a fixed loader for a private route */}
        <img src={safe} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      </span>
    );
  }
  const hue = avatarHue(name);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-surface",
        className,
      )}
      // dark enough that the white initials keep 4.5:1 on every hue (yellow-green is the hard one)
      style={{ backgroundColor: `hsl(${hue}, 45%, 30%)` }}
    >
      {initials(name)}
    </span>
  );
}
