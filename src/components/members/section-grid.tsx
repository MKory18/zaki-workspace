"use client";

import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { SECTION_ACTIONS, sectionGrid, type ActorInfo, type ContractMember, type SectionCell } from "@/lib/members-ui";
import type { Capability } from "@/server/policy/capabilities";

/**
 * «الأقسام»: the per-person grid (the owner's decision, 2026-10-26). A row per section, «يشوف / يضيف ويعدّل / يحذف»
 * across; each box is the same switch as the list above it and is saved at once by the caller. A box the owner changed
 * from the rank's template carries a small dot, and a section the person can not see greys out its other boxes.
 */
export function SectionGrid({
  member,
  actor,
  editable,
  busy,
  pendingCapability,
  onToggle,
}: {
  member: ContractMember;
  actor: ActorInfo;
  editable: boolean;
  busy: boolean;
  pendingCapability: Capability | null;
  onToggle: (capability: Capability, on: boolean) => void;
}) {
  const { t } = useI18n();
  const rows = sectionGrid(member, actor, editable);
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="section-grid-title" className="rounded-xl border border-border bg-surface">
      <header className="border-b border-border px-3 py-2">
        <h4 id="section-grid-title" className="text-xs font-semibold text-fg-muted">
          {t("members.sections_title")}
        </h4>
        <p className="mt-0.5 text-xs leading-5 text-muted">{t("members.sections_intro")}</p>
      </header>
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="text-xs text-fg-muted">
            <th scope="col" className="w-[34%] px-3 py-2 text-start font-medium">
              {t("members.sections_section")}
            </th>
            {SECTION_ACTIONS.map((action) => (
              <th key={action} scope="col" className="px-1 py-2 text-center font-medium">
                {t(`members.action.${action}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.section}>
              <th scope="row" className="px-3 py-2 text-start font-medium text-fg">
                {t(`members.section.${row.section}`)}
              </th>
              {SECTION_ACTIONS.map((action) => {
                const cell = row.cells[action];
                return (
                  <td key={action} className="px-1 py-1.5 text-center">
                    {cell ? (
                      <GridBox
                        cell={cell}
                        label={`${t(`members.section.${row.section}`)}: ${t(`members.action.${action}`)}`}
                        busy={pendingCapability === cell.capability}
                        waiting={busy && pendingCapability !== cell.capability}
                        onToggle={onToggle}
                      />
                    ) : (
                      <span className="text-muted" aria-hidden="true">
                        —
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2 text-xs leading-5 text-muted">
        <span className="me-1 inline-block size-1.5 rounded-full bg-warn align-middle" aria-hidden="true" />
        {t("members.sections_legend")}
      </p>
    </section>
  );
}

/** One box: a real checkbox button, 44px square for a thumb, with a dot when it differs from the rank's template. */
function GridBox({
  cell,
  label,
  busy,
  waiting,
  onToggle,
}: {
  cell: SectionCell;
  label: string;
  busy: boolean;
  waiting: boolean;
  onToggle: (capability: Capability, on: boolean) => void;
}) {
  const { t } = useI18n();
  const locked = cell.locked !== null;
  const title = cell.needsView ? t("members.sections_needs_view") : cell.locked === "actor_lacks" ? t("members.caps_locked_actor") : undefined;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={cell.on}
      aria-label={label}
      aria-busy={busy || undefined}
      title={title}
      disabled={locked}
      onClick={() => {
        if (!waiting && !busy) onToggle(cell.capability, !cell.on);
      }}
      className={cn(
        "relative inline-flex size-11 items-center justify-center rounded-lg transition-colors",
        locked ? "cursor-not-allowed opacity-50" : "hover:bg-surface-2",
        waiting && "opacity-70",
      )}
    >
      <span
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-md border-2",
          cell.on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface",
        )}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : cell.on ? <Check className="size-4" aria-hidden="true" /> : null}
      </span>
      {cell.customized && !cell.needsView ? (
        <span className="absolute end-1.5 top-1.5 size-1.5 rounded-full bg-warn" aria-hidden="true" />
      ) : null}
    </button>
  );
}
