"use client";

import React, { useState } from "react";
import { Hand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";

/**
 * The banner of a task somebody ASKED another person to take (the owner's rank rule, 2026-10-30; the server half is
 * src/server/services/task-assign.ts). Three readings of the same pending request:
 *   - `addressee`: it was asked of YOU: «قبول» or «إرجاع بسبب» (a written reason is required to return it);
 *   - `owner`: asked of somebody else, and the owner may answer for them (the same two buttons);
 *   - `waiting`: you asked; nothing to press, only the line that says whom the answer is awaited from.
 * It holds no data of its own: the page passes the request and the two functions, and refreshes after them.
 */
export type RequestBannerMode = "addressee" | "owner" | "waiting";

export function TaskAssignRequestBanner({
  mode,
  fromName,
  toName,
  busy = false,
  onAccept,
  onReturn,
  initialReturning = false,
}: {
  mode: RequestBannerMode;
  fromName: string;
  toName: string;
  busy?: boolean;
  onAccept?: () => void;
  onReturn?: (reason: string) => void;
  /** Tests draw the reason box already open. */
  initialReturning?: boolean;
}) {
  const { t } = useI18n();
  const [returning, setReturning] = useState(initialReturning);
  const [reason, setReason] = useState("");
  const text =
    mode === "waiting"
      ? t("taskreq.waiting", { to: toName })
      : mode === "owner"
        ? t("taskreq.banner.owner", { from: fromName, to: toName })
        : t("taskreq.banner", { from: fromName });

  return (
    <div role="status" className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-3">
      <p className="flex items-center gap-2 text-sm text-fg">
        <Hand className="size-4 shrink-0 text-warn" aria-hidden="true" />
        {text}
      </p>
      {mode !== "waiting" ? (
        returning ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim() && !busy) onReturn?.(reason.trim());
            }}
          >
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={t("taskreq.reason")}
              aria-label={t("taskreq.reason")}
              className="min-w-0 flex-1"
            />
            <Button type="submit" size="sm" variant="danger" disabled={busy || !reason.trim()}>
              {t("taskreq.return.send")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setReturning(false)}>
              {t("taskreq.cancel")}
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => onAccept?.()}>
              {t("taskreq.accept")}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setReturning(true)}>
              {t("taskreq.return")}
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
