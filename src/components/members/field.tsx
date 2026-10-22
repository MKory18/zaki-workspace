import type { ReactNode } from "react";

/** A labelled form control with an optional one-line hint under it. `id` must be the control's id. */
export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs leading-5 text-fg-muted">{hint}</p> : null}
    </div>
  );
}
