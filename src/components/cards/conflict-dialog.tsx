"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import {
  conflictRows,
  defaultPick,
  patchFromChoices,
  type CardSnapshot,
  type ConflictRow,
  type Pick,
  type SnapshotField,
} from "@/lib/cards/versions";
import { fieldText } from "@/lib/cards/texts";

export interface ConflictState {
  /** What the person started from. */
  original: CardSnapshot;
  /** What they were about to save. */
  mine: CardSnapshot;
  /** The card as it is now. */
  theirs: CardSnapshot;
}

/** The three ways out of «اللوحة تغيّرت». Each is a conscious choice; nothing is written by closing the dialog. */
export interface ConflictActions {
  /** Keep the chosen fields of mine on top of the current card. */
  keep: (patch: Partial<CardSnapshot>) => Promise<void>;
  /** Drop mine and show the card as it is. */
  takeTheirs: () => void;
  /** Go back to the editor with my text, now on top of the current card. */
  backToEditor: () => void;
}

/**
 * «اللوحة تغيّرت»: somebody saved the card after this person started editing, and the server refused the save (409).
 * The screen shows, field by field, what the person wrote and what is there now, and who changed it; the person picks
 * per field. A field only they changed is kept by default and a field only somebody else changed stays as it is; a field
 * both changed is left on the current card until the person picks theirs on purpose.
 */
export function ConflictDialog({ state, actions, onClose }: { state: ConflictState | null; actions: ConflictActions; onClose: () => void }) {
  const { t } = useI18n();
  const [picks, setPicks] = React.useState<Partial<Record<SnapshotField, Pick>>>({});
  const [busy, setBusy] = React.useState(false);
  const rows: ConflictRow[] = React.useMemo(() => (state ? conflictRows(state.original, state.mine, state.theirs) : []), [state]);
  // a new conflict starts from the defaults again
  React.useEffect(() => setPicks({}), [state]);

  return (
    <Modal open={state !== null} title={t("cards.p.conflict_title")} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-sm text-fg">{t("cards.p.conflict_hint")}</p>
        {rows.map((row) => {
          const picked = picks[row.field] ?? defaultPick(row);
          const option = (which: Pick, label: string, value: unknown) => (
            <label
              className={cn(
                "flex min-h-11 cursor-pointer flex-col gap-1 rounded-lg border p-2 text-sm",
                picked === which ? "border-accent bg-accent/10" : "border-border bg-surface",
              )}
            >
              <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                <input
                  type="radio"
                  name={`pick-${row.field}`}
                  checked={picked === which}
                  onChange={() => setPicks({ ...picks, [row.field]: which })}
                  className="size-5 accent-accent"
                />
                {label}
              </span>
              <span dir="auto" className="whitespace-pre-wrap break-words text-fg">{fieldText(row.field, value, t)}</span>
            </label>
          );
          return (
            <fieldset key={row.field} data-field={row.field} className="m-0 flex flex-col gap-2 rounded-xl border border-border bg-surface-1 p-2">
              <legend className="px-1 text-sm font-semibold text-fg">
                {t(`cards.field.${row.field}`)}
                {row.byMe && row.byThem ? <span className="ms-2 text-xs font-normal text-warn">{t("cards.p.conflict_both")}</span> : null}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {option("mine", t("cards.p.conflict_mine"), row.mine)}
                {option("theirs", t("cards.p.conflict_theirs"), row.theirs)}
              </div>
            </fieldset>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void actions.keep(patchFromChoices(rows, picks)).finally(() => setBusy(false));
            }}
          >
            {t("cards.p.conflict_keep")}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={actions.backToEditor}>
            {t("cards.p.conflict_back")}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={actions.takeTheirs}>
            {t("cards.p.conflict_take_theirs")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
