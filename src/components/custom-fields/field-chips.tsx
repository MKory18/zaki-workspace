"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { COLOR_CLASS, MAX_CHIP_FIELDS } from "@/lib/custom-fields";
import type { FieldCell } from "@/lib/custom-fields-display";
import { rt } from "@/lib/reminders/client";
import { cn } from "@/lib/utils";
import { useChosenFields } from "./chosen-store";

/**
 * «حقول مخصصة» on a row of the list and a card of the board: the chips of the fields the person chose (at most 3), and the
 * little picker that chooses them. The cells are cut on the server (a partner is handed none, money included); the choice is
 * only which of them to draw, and lives in this browser.
 */
export function FieldChips({ cells, className, block = false }: { cells?: Record<string, FieldCell> | undefined; className?: string; block?: boolean }) {
  const { chosen } = useChosenFields();
  if (!cells) return null;
  const shown = chosen.filter((id) => cells[id]).slice(0, MAX_CHIP_FIELDS);
  if (shown.length === 0) return null;
  const Wrap = block ? BlockWrap : React.Fragment;
  return (
    <Wrap>
      {shown.map((id) => {
        const cell = cells[id] as FieldCell;
        return (
          <span
            key={id}
            data-field-chip={id}
            title={`${cell.label}: ${cell.text}`}
            className={cn("inline-flex max-w-[12rem] items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs", cell.color ? COLOR_CLASS[cell.color] : "bg-surface-2 text-fg-muted", className)}
          >
            <span className="shrink-0 opacity-70">{cell.label}</span>
            <span className="truncate font-medium">{cell.text}</span>
          </span>
        );
      })}
    </Wrap>
  );
}

/** On a board card the chips sit on a line of their own, under the card's facts. */
function BlockWrap({ children }: { children: React.ReactNode }) {
  return (
    <div data-field-chips className="mt-1.5 flex flex-wrap gap-1">
      {children}
    </div>
  );
}

export interface PickerDef {
  id: string;
  projectId: string;
  projectName: string;
  label: string;
}

/** «حقول للعرض»: tick up to three fields to show on every task. Drawn only when the page has fields to offer. */
export function FieldChipPicker({ defs, className }: { defs: PickerDef[]; className?: string }) {
  const { chosen, toggle } = useChosenFields();
  if (defs.length === 0) return null;
  const several = new Set(defs.map((d) => d.projectId)).size > 1;
  const full = chosen.length >= MAX_CHIP_FIELDS;
  return (
    <details data-field-picker className={cn("relative", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-muted bg-surface-1 px-2.5 text-base text-fg md:h-8 md:min-h-0 md:text-xs [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal className="size-3.5" aria-hidden="true" />
        {rt("fields.list.choose")}
        {chosen.length > 0 ? <span className="text-fg-muted">({chosen.length})</span> : null}
      </summary>
      <div className="absolute end-0 z-30 mt-1 w-64 space-y-1 rounded-xl border border-border bg-surface p-2 shadow-card">
        <p className="px-1 pb-1 text-xs text-fg-muted">{rt("fields.list.choose_hint")}</p>
        {defs.map((d) => {
          const on = chosen.includes(d.id);
          return (
            <label key={d.id} className={cn("flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm text-fg hover:bg-surface-2", !on && full && "opacity-50")}>
              <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(d.id)} className="size-4 rounded border-muted" />
              <span className="min-w-0 flex-1 truncate">{several ? `${d.projectName} › ${d.label}` : d.label}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}
