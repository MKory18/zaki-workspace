"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { HomeDto } from "@/server/chat/dto";
import { WorkspaceCreateModal } from "@/components/create-forms";
import type { OrgsResponse } from "@/components/shell/space-switcher";
import { NewDmDialog } from "./new-dm-dialog";
import { SpaceTopics, type ArrangeControls } from "./space-topics";
import { DmList } from "./dm-list";
import { ct, ctCount } from "@/lib/chat/text";
import { applySavedOrder, dmScope, spaceScope } from "@/lib/chat/order";

import Link from "next/link";
export function ChatHome({ home, guest, onChanged = () => undefined }: { home: HomeDto; guest: boolean; onChanged?: () => void }) {
  // «⋯» next to each topic and chat (the «قائمة المحادثة» switch); the owner's «حذف نهائي» among it
  const menu = home.rowMenu ? { menu: true, canPurge: Boolean(home.canPurge), onChanged } : undefined;
  // «ترتيب»: the person's own order. `mine` holds what was just dragged (shown at once, saved in the background),
  // `custom` which lists have an order of their own now.
  const [arranging, setArranging] = useState(false);
  const [mine, setMine] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "reset_error">("idle");
  const minePrev = useRef<Record<string, string[] | undefined>>({});
  const myDmScope = home.dmScope ?? dmScope(null);
  const hasOrder = useCallback((scope: string) => custom[scope] ?? (home.ordered ?? []).includes(scope), [custom, home.ordered]);
  const saveOrder = useCallback((scope: string, ids: string[]) => {
    setMine((prev) => { minePrev.current[scope] = prev[scope]; return { ...prev, [scope]: ids }; });
    setSaveState("saving");
    fetch("/api/chat/order", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope, order: ids }) })
      .then((r) => {
        if (!r.ok) throw new Error("order");
        setCustom((prev) => ({ ...prev, [scope]: true }));
        setSaveState("saved");
      })
      .catch(() => {
        // the list goes back to what it was, and the person is told
        setMine((prev) => {
          const next = { ...prev };
          const before = minePrev.current[scope];
          if (before) next[scope] = before; else delete next[scope];
          return next;
        });
        setSaveState("error");
      });
  }, []);
  const resetOrder = useCallback((scope: string) => {
    setSaveState("saving");
    fetch(`/api/chat/order?scope=${encodeURIComponent(scope)}`, { method: "DELETE" })
      .then((r) => {
        if (!r.ok) throw new Error("order");
        setMine((prev) => { const next = { ...prev }; delete next[scope]; return next; });
        setCustom((prev) => ({ ...prev, [scope]: false }));
        setSaveState("saved");
        onChanged(); // the list comes back in the original order
      })
      .catch(() => setSaveState("reset_error"));
  }, [onChanged]);
  const arrange: ArrangeControls = { on: arranging, onSave: saveOrder, onReset: resetOrder, hasOrder };
  const spaces = home.spaces.map((space) => ({
    ...space,
    topics: applySavedOrder(space.topics, mine[spaceScope(space.id)], (t) => (t.archived ? "a" : t.pinned ? "p" : "u")),
  }));
  const dms = applySavedOrder(home.dms, mine[myDmScope]);
  const canArrange = spaces.some((sp) => sp.topics.length > 1) || (!guest && dms.length > 1);
  const [allCompany, setAllCompany] = useState(false);
  const [newDm, setNewDm] = useState(false);
  const [creatingSpace, setCreatingSpace] = useState(false);
  // «افتح مساحة» only for whoever may open one (`spaces.create`), the same answer the space switcher uses
  const [orgs, setOrgs] = useState<OrgsResponse["organizations"]>([]);
  useEffect(() => {
    if (guest) return;
    let active = true;
    fetch("/api/workspaces", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<OrgsResponse>) : { organizations: [] }))
      .then((data) => { if (active) setOrgs(data.organizations); })
      .catch(() => { /* no button: the space switcher stays the way in */ });
    return () => { active = false; };
  }, [guest]);
  const canCreateSpace = !guest && orgs.some((org) => org.canCreateSpaces);
  const [oversight, setOversight] = useState<{ items: { id: string; kind: string; title: string; spaceName: string | null; membersCount: number; lastMessageAt: string | null; names?: string[] }[]; nextCursor: string | null } | null>(null);
  const [oversightError, setOversightError] = useState(false);
  useEffect(() => {
    if (!allCompany || !home.canOversee) return;
    let active = true;
    fetch("/api/chat/oversight/conversations?limit=100", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("oversight"); return r.json(); })
      .then((data) => { if (active) { setOversight(data); setOversightError(false); } })
      .catch(() => { if (active) setOversightError(true); });
    return () => { active = false; };
  }, [allCompany, home.canOversee]);
  return (
    <div dir="rtl" className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-3 p-3 text-fg sm:gap-4 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{ct("chath.title")}</h1>
        {canArrange && !allCompany && (
          <button
            type="button"
            aria-pressed={arranging}
            aria-label={ct("chato.toggle.label")}
            onClick={() => { setArranging((on) => !on); setSaveState("idle"); }}
            className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface-1 px-4 text-sm aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-fg"
          >
            {ct("chato.toggle")}
          </button>
        )}
        {home.canOversee && <div className="inline-flex rounded-xl border border-border bg-surface-1 p-1" role="group" aria-label={ct("chath.scope")}>
          <button type="button" aria-pressed={!allCompany} onClick={() => setAllCompany(false)} className="min-h-11 rounded-lg px-3 py-2 text-sm aria-pressed:bg-accent aria-pressed:text-accent-fg">{ct("chath.scope.mine")}</button>
          <button type="button" aria-pressed={allCompany} onClick={() => setAllCompany(true)} className="min-h-11 rounded-lg px-3 py-2 text-sm aria-pressed:bg-accent aria-pressed:text-accent-fg">{ct("chath.scope.company")}</button>
        </div>}
      </header>
      {arranging && !allCompany && (
        <div className="rounded-xl border border-info/40 bg-info/10 p-3 text-sm">
          <p>{ct("chato.hint")}</p>
          <p className="mt-1 text-fg-muted">{ct("chato.hint.keys")}</p>
          <p role="status" aria-live="polite" className="mt-1 min-h-5 text-xs text-fg-muted">{saveState === "saving" ? ct("chato.saving") : saveState === "saved" ? ct("chato.saved") : ""}</p>
          {(saveState === "error" || saveState === "reset_error") && <p role="alert" className="mt-1 text-sm text-danger">{ct(saveState === "error" ? "chato.error" : "chato.reset_error")}</p>}
        </div>
      )}
      {allCompany ? <section className="rounded-2xl border border-border bg-surface-1 p-4"><h2 className="font-semibold">{ct("chath.company.title")}</h2><p className="mt-2 text-sm text-fg-muted">{ct("chath.company.hint")}</p>{oversightError && <p role="alert" className="mt-2 text-sm text-danger">{ct("chath.load_failed")}</p>}{!oversight && !oversightError && <p role="status" className="mt-2 text-sm text-fg-muted">{ct("chath.loading")}</p>}<ul className="mt-3 divide-y divide-border">{oversight?.items.map((item) => <li key={item.id} className="flex min-h-12 items-center gap-3 py-2"><span className="min-w-0 flex-1 truncate">{item.kind === "DM" ? (item.names?.length === 2 ? ct("chath.company.dm", { a: item.names[0]!, b: item.names[1]! }) : ct("chath.company.dm_fallback")) : item.title || ct("chatc.title_fallback")}<small className="block text-fg-muted">{item.spaceName ?? ct("chath.company.no_space")} · {ctCount("chath.participants", item.membersCount)}</small></span><Link className="inline-flex min-h-11 items-center text-accent underline" href={`/chat/${item.id}`}>{ct("chath.company.open")}</Link></li>)}</ul>{oversight?.nextCursor && <p className="mt-2 text-xs text-fg-muted">{ct("chath.company.more")}</p>}</section> : <>
        {spaces.length ? (
          <div className="space-y-3">{spaces.map((space) => <SpaceTopics key={space.id} space={space} menu={menu} arrange={arrange} />)}</div>
        ) : (
          <section aria-labelledby="chat-spaces" className="rounded-2xl border border-border bg-surface-1 p-4">
            <h2 id="chat-spaces" className="mb-3 font-semibold">{ct("chath.spaces")}</h2>
            <p className="text-sm text-fg-muted">{ct("chath.no_spaces")}</p>
            {canCreateSpace && <button type="button" onClick={() => setCreatingSpace(true)} className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-accent px-3 text-sm text-accent-fg">{ct("chath.new_space")}</button>}
          </section>
        )}
        {!guest && <section aria-labelledby="chat-dms" className="rounded-2xl border border-border bg-surface-1 p-4"><h2 id="chat-dms" className="mb-3 font-semibold">{ct("chath.dms")}</h2>
          {arranging && hasOrder(myDmScope) && <button type="button" onClick={() => resetOrder(myDmScope)} className="mb-2 inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm hover:bg-surface-2">{ct("chato.reset")}</button>}
          {dms.length ? <DmList dms={dms} menu={menu ? { canPurge: menu.canPurge } : undefined} onChanged={onChanged} arrange={arranging ? { scope: myDmScope, onSave: saveOrder } : undefined} /> : <p className="text-sm text-fg-muted">{ct("chath.no_dms")}</p>}
          <button type="button" onClick={() => setNewDm(true)} className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-accent px-3 text-sm text-accent-fg">{ct("chath.new_dm")}</button>
        </section>}
      </>}
      {!guest && <NewDmDialog open={newDm} onOpenChange={setNewDm} />}
      {canCreateSpace && <WorkspaceCreateModal open={creatingSpace} onClose={() => setCreatingSpace(false)} organizations={orgs.map((org) => ({ id: org.id, name: org.name, canAdmin: org.canCreateSpaces }))} />}
    </div>
  );
}
