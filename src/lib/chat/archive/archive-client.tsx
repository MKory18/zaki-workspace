"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArchiveList } from "@/components/archive/archive-list";
import { AR } from "@/lib/i18n/dict";
import type { ArchivePageDto, ArchiveType } from "@/server/chat/dto";

import type { ArchiveFilterOptions } from "@/server/chat/archive";

const TYPES: Array<ArchiveType | "all"> = ["all", "deleted", "edited", "moderation", "closed"];
const typeLabel = (type: ArchiveType | "all") => type === "all" ? AR["archive.title"] : AR[`archive.type.${type}`];

export function ArchiveClient({ options }: { options: ArchiveFilterOptions }) {
  const [type, setType] = useState<ArchiveType | "all">("all");
  const [personId, setPersonId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<ArchivePageDto>({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [generation, setGeneration] = useState(0);

  const fetchPage = useCallback(async (cursor?: string, replace = false) => {
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    if (type !== "all") params.set("type", type);
    if (personId.trim()) params.set("personId", personId.trim());
    if (spaceId.trim()) params.set("spaceId", spaceId.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/chat/archive?${params.toString()}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("archive request failed");
      const page = await response.json() as ArchivePageDto;
      setResult((old) => replace ? page : { items: [...old.items, ...page.items], nextCursor: page.nextCursor });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [type, personId, spaceId, from, to]);

  useEffect(() => { void fetchPage(undefined, true); }, [fetchPage, generation]);

  return <div className="space-y-5">
    <div className="flex gap-2 overflow-x-auto border-b border-border" role="tablist" aria-label={AR["archive.filter.type"]}>
      {TYPES.map((value) => <button key={value} type="button" role="tab" aria-selected={type === value} onClick={() => setType(value === "all" ? "all" : value)} className={`min-h-11 shrink-0 border-b-2 px-3 text-sm ${type === value ? "border-accent text-accent" : "border-transparent text-fg-muted"}`}>{typeLabel(value)}</button>)}
    </div>
    <form className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface-1 p-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(event) => { event.preventDefault(); setGeneration((value) => value + 1); }}>
      <label className="space-y-1 text-xs text-fg-muted">{AR["archive.filter.person"]}<select value={personId} onChange={(event) => setPersonId(event.target.value)} className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-base text-fg"><option value="">—</option>{options.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label className="space-y-1 text-xs text-fg-muted">{AR["archive.filter.space"]}<select value={spaceId} onChange={(event) => setSpaceId(event.target.value)} className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-base text-fg"><option value="">—</option>{options.spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
      <label className="space-y-1 text-xs text-fg-muted">{AR["archive.filter.from"]}<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-base text-fg" /></label>
      <label className="space-y-1 text-xs text-fg-muted">{AR["archive.filter.to"]}<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-base text-fg" /></label>
      <div className="flex items-end gap-2"><button className="min-h-11 flex-1 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg" type="submit">{AR["archive.apply"]}</button><button className="min-h-11 rounded-lg border border-border px-3 text-sm" type="button" onClick={() => { setPersonId(""); setSpaceId(""); setFrom(""); setTo(""); setType("all"); setGeneration((value) => value + 1); }}>{AR["archive.clear"]}</button></div>
    </form>
    {error && <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{AR["archive.error"]} <button className="underline" onClick={() => setGeneration((value) => value + 1)}>{AR["archive.apply"]}</button></div>}
    {loading && <p role="status" className="text-sm text-fg-muted">{AR["archive.loading"]}</p>}
    <ArchiveList items={result.items} />
    {result.nextCursor && !loading && <button type="button" className="min-h-11 w-full rounded-lg border border-border bg-surface-1 px-4 text-sm font-medium" onClick={() => void fetchPage(result.nextCursor ?? undefined)}>{AR["archive.loadMore"]}</button>}
  </div>;
}
