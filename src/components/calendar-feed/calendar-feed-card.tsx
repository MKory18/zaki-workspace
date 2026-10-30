"use client";

import React from "react";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { whenLabel } from "@/lib/reminders/client";
import { copyText } from "@/components/members/clipboard";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { FeedTokenDto } from "@/server/services/calendar-feed";

/** A string of the dictionary, with `{name}` placeholders filled (the card renders without a query client, like the reminders card). */
const ct = (key: string, vars?: Record<string, string | number>): string => interpolate(AR[key] ?? key, vars);

/** The dictionary key of what a failed request said (a refusal message, or a validation key in `details`). */
function errorKeyOf(body: unknown): string {
  const b = (body ?? {}) as { message?: unknown; details?: unknown };
  const detail = Array.isArray(b.details) ? (b.details as { message?: unknown }[]).find((d) => typeof d?.message === "string" && d.message in AR) : undefined;
  if (detail) return detail.message as string;
  if (typeof b.message === "string" && b.message in AR) return b.message;
  return "calfeed.failed";
}

export interface CalendarFeedViewProps {
  tokens: FeedTokenDto[] | null;
  timeZone: string;
  /** The address of the link just made, shown once. */
  createdUrl: string | null;
  label: string;
  busy?: boolean;
  error?: string;
  note?: string;
  onLabel: (value: string) => void;
  onCreate: () => void;
  onCopy: () => void;
  onDismiss: () => void;
  onRevoke: (id: string) => void;
}

/**
 * «اشتراك التقويم» — the card on the calendar page (the page itself is not rewritten: one line mounts it, when the
 * switch of the company is on and the person is not a guest).
 *
 * The link is shown ONCE, with a copy button and the three short ways to add it; after that only the label, the dates and
 * «إلغاء» of each link remain (the server keeps the hash, never the token). ⚠️ Whoever holds the link sees the titles of
 * the person's tasks, reminders and milestones; 🔧 «إلغاء» kills it at once. Both are drawn together.
 */
export function CalendarFeedView(props: CalendarFeedViewProps) {
  const { tokens, timeZone, createdUrl, label, busy = false, error = "", note = "" } = props;
  return (
    <section aria-labelledby="calfeed-title" data-calendar-feed className="rounded-card border border-border bg-surface-1 shadow-card">
      <header className="px-4 pt-3">
        <h2 id="calfeed-title" className="text-base font-semibold text-fg">
          {ct("calfeed.title")}
        </h2>
        <p className="text-xs text-fg-muted">{ct("calfeed.hint")}</p>
      </header>

      <div className="space-y-3 px-4 py-3">
        {createdUrl ? (
          <div role="group" aria-label={ct("calfeed.once_title")} data-calendar-feed-once className="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
            <p className="text-sm font-medium text-fg">{ct("calfeed.once_title")}</p>
            <p className="text-xs text-fg-muted">{ct("calfeed.once_hint")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input readOnly dir="ltr" value={createdUrl} aria-label={ct("calfeed.url_aria")} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="primary" size="sm" onClick={props.onCopy}>
                {ct("calfeed.copy")}
              </Button>
            </div>
            <div>
              <p className="text-xs font-medium text-fg">{ct("calfeed.steps_title")}</p>
              <ul className="mt-1 list-disc space-y-0.5 ps-5 text-xs text-fg-muted">
                <li>{ct("calfeed.step_google")}</li>
                <li>{ct("calfeed.step_apple")}</li>
                <li>{ct("calfeed.step_outlook")}</li>
              </ul>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={props.onDismiss}>
              {ct("calfeed.done")}
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              props.onCreate();
            }}
          >
            <label className="min-w-0 flex-1 basis-48">
              <Label>{ct("calfeed.label_field")}</Label>
              <Input value={label} maxLength={60} placeholder={ct("calfeed.label_placeholder")} onChange={(e) => props.onLabel(e.target.value)} />
            </label>
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {ct("calfeed.create")}
            </Button>
          </form>
        )}

        <div>
          <h3 className="text-xs font-medium text-fg">{ct("calfeed.list_title")}</h3>
          {tokens === null ? (
            error ? null : <p className="mt-1 text-sm text-fg-muted">{ct("calfeed.loading")}</p>
          ) : tokens.length === 0 ? (
            <p className="mt-1 text-sm text-fg-muted">{ct("calfeed.empty")}</p>
          ) : (
            <ul className="mt-1 divide-y divide-border/60">
              {tokens.map((t) => (
                <li key={t.id} data-feed-token={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-fg">
                      <span className="truncate">{t.label}</span>
                      {t.stale ? (
                        <span title={ct("calfeed.stale_hint")} className="rounded bg-warn/10 px-1.5 py-0.5 text-xs font-medium text-warn">
                          {ct("calfeed.stale")}
                        </span>
                      ) : null}
                    </p>
                    <p className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
                      <span suppressHydrationWarning>{ct("calfeed.created_at", { when: whenLabel(t.createdAt, timeZone) })}</span>
                      <span suppressHydrationWarning>{t.lastUsedAt ? ct("calfeed.last_used", { when: whenLabel(t.lastUsedAt, timeZone) }) : ct("calfeed.never_used")}</span>
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} aria-label={ct("calfeed.revoke_aria", { label: t.label })} onClick={() => props.onRevoke(t.id)}>
                    {ct("calfeed.revoke")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {note ? (
          <p role="status" className="text-xs text-ok">
            {ct(note)}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {ct(error)}
          </p>
        ) : null}
        <div className="space-y-0.5 border-t border-border pt-2 text-xs text-fg-muted">
          <p>
            <span aria-hidden="true">⚠️ </span>
            {ct("calfeed.warn")}
          </p>
          <p>
            <span aria-hidden="true">🔧 </span>
            {ct("calfeed.fix")}
          </p>
        </div>
      </div>
    </section>
  );
}

export function CalendarFeedCard({ timeZone }: { timeZone: string }) {
  const [tokens, setTokens] = React.useState<FeedTokenDto[] | null>(null);
  const [createdUrl, setCreatedUrl] = React.useState<string | null>(null);
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/me/calendar-feed", { cache: "no-store" });
      if (!res.ok) {
        setError(errorKeyOf(await res.json().catch(() => null)));
        return;
      }
      setTokens(((await res.json()) as { tokens: FeedTokenDto[] }).tokens);
      setError("");
    } catch {
      setError("calfeed.failed");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/me/calendar-feed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: label.trim() || null }) });
      const body = (await res.json().catch(() => null)) as { url?: string } | null;
      if (!res.ok || !body?.url) setError(errorKeyOf(body));
      else {
        setError("");
        setCreatedUrl(body.url);
        setLabel("");
      }
    } catch {
      setError("calfeed.failed");
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(`/api/me/calendar-feed/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) setError(errorKeyOf(await res.json().catch(() => null)));
      else {
        setError("");
        setNote("calfeed.revoked");
      }
    } catch {
      setError("calfeed.failed");
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function copy() {
    if (!createdUrl) return;
    if (await copyText(createdUrl)) {
      setError("");
      setNote("calfeed.copied");
    } else {
      setError("calfeed.copy_failed");
    }
  }

  return (
    <CalendarFeedView
      tokens={tokens}
      timeZone={timeZone}
      createdUrl={createdUrl}
      label={label}
      busy={busy}
      error={error}
      note={note}
      onLabel={setLabel}
      onCreate={() => void create()}
      onCopy={() => void copy()}
      onDismiss={() => {
        setCreatedUrl(null);
        setNote("");
      }}
      onRevoke={(id) => void revoke(id)}
    />
  );
}
