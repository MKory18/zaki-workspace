"use client";
import React from "react";
import type { HomeDto, MessageDto } from "@/server/chat/dto";
import { AR } from "@/lib/i18n/dict";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const tr = (key: string) => AR[key] ?? key;

export type ForwardTarget = { id: string; label: string };

/** Where a message may go: every topic I may post in and every DM of mine, never the conversation it is in. */
export function forwardTargets(home: HomeDto, from: string): ForwardTarget[] {
 const topics = home.spaces.flatMap((s) => s.topics.filter((t) => t.canPost).map((t) => ({ id: t.id, label: `${s.name} › ${t.emoji ? `${t.emoji} ` : ""}${t.title}` })));
 const dms = home.dms.map((d) => ({ id: d.id, label: d.peer.name }));
 return [...topics, ...dms].filter((t) => t.id !== from);
}

/** «تحويل»: pick the conversation; the server checks again that I may write there. */
export function ForwardDialog({ message, from, onClose, onDone }: { message: MessageDto | null; from: string; onClose: () => void; onDone: (ok: boolean) => void }) {
 const [targets, setTargets] = React.useState<ForwardTarget[] | null>(null);
 const [sending, setSending] = React.useState<string | null>(null);
 React.useEffect(() => {
  if (!message) return;
  setTargets(null);
  let alive = true;
  void fetch("/api/chat/home", { cache: "no-store" })
   .then((r) => (r.ok ? (r.json() as Promise<HomeDto>) : Promise.reject(new Error("home"))))
   .then((home) => alive && setTargets(forwardTargets(home, from)))
   .catch(() => alive && setTargets([]));
  return () => { alive = false; };
 }, [message, from]);
 async function send(to: string) {
  if (!message) return;
  setSending(to);
  try {
   const r = await fetch(`/api/chat/messages/${encodeURIComponent(message.id)}/forward`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId: to }),
   });
   onDone(r.ok);
  } catch {
   onDone(false);
  } finally {
   setSending(null);
  }
 }
 return (
  <Dialog open={message !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
   <DialogContent aria-label={tr("chatc.menu.forward_title")}>
    <DialogHeader>
     <DialogTitle>{tr("chatc.menu.forward_title")}</DialogTitle>
    </DialogHeader>
    <DialogBody>
     {targets === null ? (
      <p role="status">…</p>
     ) : targets.length === 0 ? (
      <p>{tr("chatc.menu.forward_empty")}</p>
     ) : (
      <ul className="flex flex-col">
       {targets.map((t) => (
        <li key={t.id}>
         <button type="button" disabled={sending !== null} className="min-h-11 w-full rounded-md px-3 text-start hover:bg-surface-2 disabled:opacity-60" onClick={() => void send(t.id)}>
          {t.label}
         </button>
        </li>
       ))}
      </ul>
     )}
    </DialogBody>
   </DialogContent>
  </Dialog>
 );
}

/** «ملاحظة للمشرفين»: a line only the space's moderators and the owner read. */
export function NoteDialog({ message, onClose, onDone }: { message: MessageDto | null; onClose: () => void; onDone: (ok: boolean) => void }) {
 const [body, setBody] = React.useState("");
 const [saving, setSaving] = React.useState(false);
 React.useEffect(() => { setBody(""); }, [message]);
 async function save(event: React.FormEvent) {
  event.preventDefault();
  if (!message || !body.trim()) return;
  setSaving(true);
  try {
   const r = await fetch(`/api/chat/messages/${encodeURIComponent(message.id)}/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: body.trim() }),
   });
   onDone(r.ok);
  } catch {
   onDone(false);
  } finally {
   setSaving(false);
  }
 }
 return (
  <Dialog open={message !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
   <DialogContent aria-label={tr("chatc.menu.note_title")}>
    <form onSubmit={save}>
     <DialogHeader>
      <DialogTitle>{tr("chatc.menu.note_title")}</DialogTitle>
     </DialogHeader>
     <DialogBody>
      <label htmlFor="chat-note" className="mb-1 block text-sm text-fg-muted">{tr("chatc.menu.note_hint")}</label>
      <textarea id="chat-note" value={body} onChange={(e) => setBody(e.currentTarget.value)} maxLength={2000} className="min-h-24 w-full rounded-md border border-border bg-surface p-2" />
     </DialogBody>
     <DialogFooter>
      <Button type="button" variant="secondary" onClick={onClose}>{tr("chatc.cancel")}</Button>
      <Button type="submit" disabled={saving || !body.trim()}>{tr("chatc.save")}</Button>
     </DialogFooter>
    </form>
   </DialogContent>
  </Dialog>
 );
}
