"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ct } from "@/lib/chat/text";
import { callApi } from "./call-api";

/**
 * «اجتماع جديد»: a call with a link, in the space the person is in. The link opens it for the space's people only,
 * each with their own account (the owner's decision, 2026-10-25); the server checks it on every pass.
 */
export function MeetingButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const out = await callApi<{ path: string }>("/api/calls", { title: title.trim() || null, video: true });
      router.push(out.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : ct("calls.action_failed"));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 text-sm hover:bg-surface-2">
        <span aria-hidden="true">🎥</span>
        {ct("calls.meeting_new")}
      </button>
    );
  }
  return (
    <form onSubmit={(e) => void create(e)} className="flex w-full flex-col gap-2 rounded-xl border border-border bg-surface-1 p-3">
      <label className="flex flex-col gap-1 text-sm">
        <span>{ct("calls.meeting_title")}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className="min-h-11 rounded-lg border border-border bg-surface px-3" />
      </label>
      <p className="text-xs text-fg-muted">{ct("calls.meeting_hint")}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-60">
          {ct("calls.meeting_create")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg px-3 text-sm hover:bg-surface-2">
          {ct("chatc.cancel")}
        </button>
      </div>
    </form>
  );
}
