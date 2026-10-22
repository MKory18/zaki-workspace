"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-lg border-muted bg-surface px-3 py-2 text-base text-fg placeholder:text-muted transition-colors focus:border-accent/60 md:text-sm",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
