import * as React from "react";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-4 border-2",
  md: "size-6 border-2",
  lg: "size-10 border-[3px]",
} as const;

export type SpinnerSize = keyof typeof SIZES;

export interface SpinnerProps {
  size?: SpinnerSize;
  /**
   * What a screen reader says while it spins (pass `t("common.loading")`). Without a label the
   * spinner is decoration, e.g. inside a button that already says what it is doing.
   */
  label?: string;
  className?: string;
}

/**
 * A quiet ring that turns. Under `prefers-reduced-motion` it pulses instead of turning. Colours
 * are theme tokens: the track is the border colour, the arc the accent. No hooks and no provider,
 * so server components (the loading screen) can use it too.
 */
export function Spinner({ size = "md", label, className }: SpinnerProps): React.JSX.Element {
  const ring = (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-border border-t-accent motion-reduce:animate-pulse",
        SIZES[size],
        className,
      )}
    />
  );
  if (!label) return ring;
  return (
    <span role="status" className="inline-flex items-center">
      {ring}
      <span className="sr-only">{label}</span>
    </span>
  );
}
