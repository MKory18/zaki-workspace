"use client";

import React, { useEffect, useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ct } from "@/lib/chat/text";

type TopicType = "DISCUSSION" | "ANNOUNCEMENTS" | "TASKS" | "IDEAS" | "FOLLOWUP";
type Audience = "space" | "section" | "people";
type Person = { id: string; name: string };

const TYPES: { value: TopicType; emoji: string }[] = [
  { value: "DISCUSSION", emoji: "💬" },
  { value: "ANNOUNCEMENTS", emoji: "📢" },
  { value: "TASKS", emoji: "✅" },
  { value: "IDEAS", emoji: "💡" },
  { value: "FOLLOWUP", emoji: "🔁" },
];

/**
 * «موضوع جديد» (the owner's ask, 2026-10-25): a name, a kind (نقاش، تنبيهات، مهام، أفكار، متابعة) and who it is for —
 * the whole space, one of its «مقاطع», or people named one by one. The space's ADMIN and the OWNER open topics;
 * the server decides again (src/server/chat/topics.ts) and the new topic opens at once.
 */
export function NewTopicDialog({
  open,
  onOpenChange,
  space,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: { id: string; name: string; sections: { id: string; name: string }[] };
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TopicType>("DISCUSSION");
  const [audience, setAudience] = useState<Audience>("space");
  const [sectionId, setSectionId] = useState(space.sections[0]?.id ?? "");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // the people of the space, only when the topic is for named people
  useEffect(() => {
    if (!open || audience !== "people" || people) return;
    let alive = true;
    fetch(`/api/workspaces/${encodeURIComponent(space.id)}/members`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("members"); return r.json() as Promise<{ members: Person[] }>; })
      .then((data) => { if (alive) setPeople(data.members); })
      .catch(() => { if (alive) setError(ct("chath.topic.people_failed")); });
    return () => { alive = false; };
  }, [open, audience, people, space.id]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !title.trim()) return;
    if (audience === "people" && picked.size === 0) {
      setError(ct("chath.topic.pick_people"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = {
        title: title.trim(),
        topicType: type,
        teamId: audience === "section" ? sectionId || null : null,
        restricted: audience === "people",
        memberIds: audience === "people" ? [...picked] : undefined,
      };
      const r = await fetch(`/api/chat/spaces/${encodeURIComponent(space.id)}/topics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("topic");
      const { id } = (await r.json()) as { id: string };
      window.location.assign(`/chat/${encodeURIComponent(id)}`);
    } catch {
      setError(ct("chath.topic.failed"));
      setBusy(false);
    }
  }

  const field = "h-11 w-full rounded-lg border border-muted bg-surface px-3 text-base md:h-9 md:text-sm";
  const choice = "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{ct("chath.topic.title", { space: space.name })}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={(e) => void submit(e)} className="space-y-4">
            <div>
              <label htmlFor="new-topic-name" className="mb-1 block text-sm font-medium">{ct("chath.topic.name")}</label>
              <input id="new-topic-name" required maxLength={120} value={title} onChange={(e) => setTitle(e.currentTarget.value)} className={field} />
            </div>

            <fieldset>
              <legend className="mb-1 text-sm font-medium">{ct("chath.topic.kind")}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TYPES.map((k) => (
                  <label key={k.value} className={choice}>
                    <input type="radio" name="topic-type" value={k.value} checked={type === k.value} onChange={() => setType(k.value)} className="sr-only" />
                    <span aria-hidden="true">{k.emoji}</span>
                    {ct(`chath.topic.type.${k.value}`)}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-fg-muted">{ct(`chath.topic.type_hint.${type}`)}</p>
            </fieldset>

            <fieldset>
              <legend className="mb-1 text-sm font-medium">{ct("chath.topic.for")}</legend>
              <div className="space-y-2">
                <label className={choice}>
                  <input type="radio" name="topic-audience" checked={audience === "space"} onChange={() => setAudience("space")} className="sr-only" />
                  {ct("chath.topic.for.space")}
                </label>
                {space.sections.length > 0 && (
                  <label className={choice}>
                    <input type="radio" name="topic-audience" checked={audience === "section"} onChange={() => setAudience("section")} className="sr-only" />
                    {ct("chath.topic.for.section")}
                  </label>
                )}
                <label className={choice}>
                  <input type="radio" name="topic-audience" checked={audience === "people"} onChange={() => setAudience("people")} className="sr-only" />
                  <span aria-hidden="true">🔒</span>
                  {ct("chath.topic.for.people")}
                </label>
              </div>
            </fieldset>

            {audience === "section" && (
              <div>
                <label htmlFor="new-topic-section" className="mb-1 block text-sm font-medium">{ct("chath.topic.section")}</label>
                <select id="new-topic-section" value={sectionId} onChange={(e) => setSectionId(e.currentTarget.value)} className={field}>
                  {space.sections.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            {audience === "people" && (
              <div>
                <p className="mb-1 text-sm font-medium">{ct("chath.topic.people")}</p>
                {!people && !error && <p role="status" className="text-sm text-fg-muted">{ct("chath.loading")}</p>}
                <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {(people ?? []).map((p) => (
                    <li key={p.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3">
                        <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} className="size-4" />
                        <bdi className="min-w-0 flex-1 truncate">{p.name}</bdi>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={busy || !title.trim()} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-accent px-3 text-sm font-semibold text-accent-fg disabled:opacity-60">
              {ct("chath.topic.create")}
            </button>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
