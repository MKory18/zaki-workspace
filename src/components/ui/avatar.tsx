import React from "react";
import { avatarHue, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Initials avatar with a deterministic per-name hue. */
export function Avatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
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
