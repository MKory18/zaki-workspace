"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-11 w-full rounded-lg border-muted bg-surface px-2 text-base text-fg md:h-9 md:text-sm disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
