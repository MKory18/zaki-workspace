import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A placeholder block shown while content loads. It pulses gently and holds still under
 * `prefers-reduced-motion`. It is hidden from screen readers: the screen that owns it says it is
 * loading (see src/app/(app)/loading.tsx). The caller sets the size, e.g. `h-24 w-full rounded-xl`.
 * No hooks and no provider, so server components can use it too.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-lg bg-muted/25 motion-reduce:animate-none", className)}
      {...props}
    />
  );
}
