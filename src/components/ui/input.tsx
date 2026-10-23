"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-lg border-muted bg-surface px-3 text-base text-fg placeholder:text-muted transition-colors focus:border-accent/60 md:h-9 md:text-sm disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("mb-1 block text-xs font-medium text-fg-muted", className)}>{children}</span>;
}
