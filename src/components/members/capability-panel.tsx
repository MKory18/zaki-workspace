"use client";

import { useId, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  capabilityGroups,
  canResetCapabilities,
  type ActorInfo,
  type CapabilityPanelMode,
  type CapabilityRow,
  type ContractMember,
  type TFn,
} from "@/lib/members-ui";
import type { Capability } from "@/server/policy/capabilities";
import { SwitchRow } from "./switch-row";

/**
 * The switches of one person, grouped by area, each with a plain Arabic title, a one-line
 * explanation and a small label that shows whether it is what the rank gives or something the owner
 * changed. A guest (external partner) shows the sentence that partners hold no capability instead of
 * switches. Only capabilities that are wired today are offered (see `capabilityGroups`): the owner-only
 * archive and the ones later phases will wire are not listed, and a group with none is not shown.
 * Each flip is saved at once by the caller.
 */
export function CapabilityPanel({
  member,
  actor,
  mode,
  busy,
  pendingCapability,
  onToggle,
  onReset,
}: {
  member: ContractMember;
  actor: ActorInfo;
  mode: CapabilityPanelMode;
  /** A save is in flight: every switch waits for it. */
  busy: boolean;
  pendingCapability: Capability | null;
  onToggle: (capability: Capability, on: boolean) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const uid = useId();

  if (mode === "owner") return <p className="text-sm text-fg-muted">{t("members.caps_owner")}</p>;
  if (mode === "guest") return <p className="rounded-lg bg-surface-2 p-3 text-sm leading-6 text-fg-muted">{t("members.caps_guest")}</p>;

  const editable = mode === "editable";
  const groups = capabilityGroups(member, actor, editable);

  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-fg-muted">{editable ? t("members.caps_intro") : t("members.caps_readonly")}</p>

      {groups.map((group) => {
        const headingId = `${uid}-${group.id}`;
        return (
          <section key={group.id} aria-labelledby={headingId} className="rounded-xl border border-border bg-surface">
            <h4 id={headingId} className="border-b border-border px-3 py-2 text-xs font-semibold text-fg-muted">
              {t(`members.group_${group.id}`)}
            </h4>
            <div className="divide-y divide-border p-1">
              {group.rows.map((row) => (
                <SwitchRow
                  key={row.capability}
                  checked={row.on}
                  disabled={row.locked !== null}
                  busy={pendingCapability === row.capability}
                  waiting={busy && pendingCapability !== row.capability}
                  title={t(`members.cap.${row.capability}.title`)}
                  hint={t(`members.cap.${row.capability}.hint`)}
                  tag={rowTag(row, t)}
                  note={rowNote(row, t)}
                  onChange={(next) => onToggle(row.capability, next)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {editable && canResetCapabilities(member, actor) ? (
        <Button
          type="button"
          variant="secondary"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onReset();
          }}
          className={cn("h-11 w-full", busy && "cursor-not-allowed opacity-50")}
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          {t("members.caps_reset")}
        </Button>
      ) : null}
    </div>
  );
}

/** "حسب الرتبة", or what the owner changed: "أُضيف فوق الرتبة" / "سُحب من الرتبة". */
function rowTag(row: CapabilityRow, t: TFn): ReactNode {
  if (!row.customized) return <span className="text-muted">{t("members.caps_default")}</span>;
  return (
    <span className="font-medium text-warn">
      {row.on ? t("members.caps_added") : t("members.caps_removed")}
    </span>
  );
}

/** The two things worth a second line: you cannot hand this one out, or it is a sensitive extra. */
function rowNote(row: CapabilityRow, t: TFn): ReactNode {
  if (row.locked === "actor_lacks") return <span className="text-muted">{t("members.caps_locked_actor")}</span>;
  if (row.sensitive && row.on && !row.rankDefault) {
    return <span className="text-warn">{t("members.caps_sensitive")}</span>;
  }
  return null;
}
