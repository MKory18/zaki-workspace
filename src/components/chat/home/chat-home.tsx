"use client";

import React, { useEffect, useState } from "react";
import type { HomeDto } from "@/server/chat/dto";
import { WorkspaceCreateModal } from "@/components/create-forms";
import type { OrgsResponse } from "@/components/shell/space-switcher";
import { NewDmDialog } from "./new-dm-dialog";
import { ct, ctCount } from "@/lib/chat/text";

export function ChatHome({ home, guest }: { home: HomeDto; guest: boolean }) {
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
    <main dir="rtl" className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 text-fg">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{ct("chath.title")}</h1>
        {home.canOversee && <div className="inline-flex rounded-xl border border-border bg-surface-1 p-1" role="group" aria-label={ct("chath.scope")}>
          <button type="button" aria-pressed={!allCompany} onClick={() => setAllCompany(false)} className="min-h-11 rounded-lg px-3 py-2 text-sm aria-pressed:bg-accent aria-pressed:text-accent-fg">{ct("chath.scope.mine")}</button>
          <button type="button" aria-pressed={allCompany} onClick={() => setAllCompany(true)} className="min-h-11 rounded-lg px-3 py-2 text-sm aria-pressed:bg-accent aria-pressed:text-accent-fg">{ct("chath.scope.company")}</button>
        </div>}
      </header>
      {allCompany ? <section className="rounded-2xl border border-border bg-surface-1 p-4"><h2 className="font-semibold">{ct("chath.company.title")}</h2><p className="mt-2 text-sm text-fg-muted">{ct("chath.company.hint")}</p>{oversightError && <p role="alert" className="mt-2 text-sm text-danger">{ct("chath.load_failed")}</p>}{!oversight && !oversightError && <p role="status" className="mt-2 text-sm text-fg-muted">{ct("chath.loading")}</p>}<ul className="mt-3 divide-y divide-border">{oversight?.items.map((item) => <li key={item.id} className="flex min-h-12 items-center gap-3 py-2"><span className="min-w-0 flex-1 truncate">{item.kind === "DM" ? (item.names?.length === 2 ? ct("chath.company.dm", { a: item.names[0]!, b: item.names[1]! }) : ct("chath.company.dm_fallback")) : item.title || ct("chatc.title_fallback")}<small className="block text-fg-muted">{item.spaceName ?? ct("chath.company.no_space")} · {ctCount("chath.participants", item.membersCount)}</small></span><a className="inline-flex min-h-11 items-center text-accent underline" href={`/chat/${item.id}`}>{ct("chath.company.open")}</a></li>)}</ul>{oversight?.nextCursor && <p className="mt-2 text-xs text-fg-muted">{ct("chath.company.more")}</p>}</section> : <>
        <section aria-labelledby="chat-spaces" className="rounded-2xl border border-border bg-surface-1 p-4">
          <h2 id="chat-spaces" className="mb-3 font-semibold">{ct("chath.spaces")}</h2>
          {home.spaces.length ? <div className="space-y-3">{home.spaces.map((space) => <details key={space.id} open className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer font-medium">{space.emoji ?? "🏢"} {space.name}{space.hasExternal && <span className="ms-2 rounded-full bg-info/10 px-2 py-1 text-xs text-info">{ct("chath.external")}</span>}</summary>
            {space.topics.length ? <ul className="mt-3 space-y-1">{space.topics.map((topic) => <li key={topic.id}><a href={`/chat/${topic.id}`} className="flex min-h-12 items-center gap-2 rounded-lg px-2 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <span>{topic.emoji ?? "💬"}</span><span className="min-w-0 flex-1 truncate">{topic.title}<small className="block truncate text-fg-muted">{topic.lastMessage?.preview ?? ct("chath.no_messages")}</small></span>
              {topic.restricted && <span role="img" aria-label={ct("chath.restricted")}>🔒</span>}{topic.closed && <span role="img" aria-label={ct("chath.closed")}>🔐</span>}{topic.mentions > 0 && <span className="rounded-full bg-warn/10 px-2 text-xs text-warn">@{topic.mentions}</span>}{topic.unread > 0 && <span className="rounded-full bg-accent/10 px-2 text-xs">{topic.unread}</span>}
            </a></li>)}</ul> : <p className="mt-3 text-sm text-fg-muted">{ct("chath.no_topics")}</p>}
          </details>)}</div> : <p className="text-sm text-fg-muted">{ct("chath.no_spaces")}</p>}
          {canCreateSpace && <button type="button" onClick={() => setCreatingSpace(true)} className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-accent px-3 text-sm text-accent-fg">{ct("chath.new_space")}</button>}
        </section>
        {!guest && <section aria-labelledby="chat-dms" className="rounded-2xl border border-border bg-surface-1 p-4"><h2 id="chat-dms" className="mb-3 font-semibold">{ct("chath.dms")}</h2>
          {home.dms.length ? <ul className="divide-y divide-border">{home.dms.map((dm) => <li key={dm.id}><a href={`/chat/${dm.id}`} className="flex min-h-12 items-center gap-3 py-2"><span className="grid size-9 place-items-center rounded-full bg-accent/10">{dm.peer.name.slice(0, 1)}</span><span className="min-w-0 flex-1 truncate">{dm.peer.name}<small className="block truncate text-fg-muted">{dm.lastMessage?.preview ?? ct("chath.start")}</small></span>{dm.lastMessage?.mine && <span role="img" aria-label={ct("chath.sent")}>✓</span>}{dm.unread > 0 && <span className="rounded-full bg-accent/10 px-2 text-xs">{dm.unread}</span>}</a></li>)}</ul> : <p className="text-sm text-fg-muted">{ct("chath.no_dms")}</p>}
          <button type="button" onClick={() => setNewDm(true)} className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-accent px-3 text-sm text-accent-fg">{ct("chath.new_dm")}</button>
        </section>}
      </>}
      {!guest && <NewDmDialog open={newDm} onOpenChange={setNewDm} />}
      {canCreateSpace && <WorkspaceCreateModal open={creatingSpace} onClose={() => setCreatingSpace(false)} organizations={orgs.map((org) => ({ id: org.id, name: org.name, canAdmin: org.canCreateSpaces }))} />}
    </main>
  );
}
