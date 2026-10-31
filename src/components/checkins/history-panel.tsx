"use client";

import React from "react";
import { ck, dayLabel, errorKeyOf } from "@/lib/checkins-client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { HistoryView } from "@/server/services/checkins";
import { AnswerCard, CountsLine, StatusPill } from "./checkin-parts";

/**
 * «السجل»: the past rounds of the space, newest first, with a search by day (one day, or from-to) and a per-person timeline.
 * The server decides what each round shows: the owner and the space's ADMIN read every answer; anybody else reads a round only
 * if they answered it themselves (a closed round says so instead).
 */
export function HistoryList({ data, personId }: { data: HistoryView; personId?: string | null }) {
  if (data.rounds.length === 0) return <p className="text-sm text-fg-muted">{ck("checkins.history.empty")}</p>;
  return (
    <ol className="space-y-4" data-checkins-history>
      {data.rounds.map((r) => (
        <li key={r.round.id} data-round-day={r.round.day} className="space-y-2 rounded-card border border-border bg-surface-1 p-3">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h4 className="text-sm font-semibold text-fg">{dayLabel(r.round.day)}</h4>
            <CountsLine counts={r.counts} />
          </header>
          {personId ? (
            <ul className="flex flex-wrap gap-2">
              {r.roster.map((e) => (
                <li key={e.userId} className="flex items-center gap-1.5 text-xs text-fg">
                  <span>{e.name}</span>
                  <StatusPill status={e.status} />
                </li>
              ))}
            </ul>
          ) : null}
          {!r.canSee ? (
            <p data-round-locked className="text-xs text-fg-muted">
              {ck("checkins.history.locked")}
            </p>
          ) : r.answers.length === 0 ? (
            <p className="text-xs text-fg-muted">{ck("checkins.history.no_answers")}</p>
          ) : (
            <div className="space-y-2">
              {r.answers.map((a) => (
                <AnswerCard key={a.userId} answer={a} questions={r.round.questions} />
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export function HistoryPanel({ workspaceId }: { workspaceId: string }) {
  const [day, setDay] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [userId, setUserId] = React.useState("");
  const [data, setData] = React.useState<HistoryView | null>(null);
  const [people, setPeople] = React.useState<HistoryView["people"]>([]);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(
    async (q: { day: string; from: string; to: string; userId: string }) => {
      setBusy(true);
      try {
        const params = new URLSearchParams({ workspaceId });
        for (const [k, v] of Object.entries(q)) if (v) params.set(k, v);
        const res = await fetch(`/api/checkins/history?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) {
          setError(errorKeyOf(await res.json().catch(() => null)));
          return;
        }
        const body = (await res.json()) as HistoryView;
        setError("");
        setData(body);
        // the people to pick from come from the unfiltered list, so choosing one does not shrink the list
        if (!q.userId) setPeople(body.people);
      } catch {
        setError("checkins.e.failed");
      } finally {
        setBusy(false);
      }
    },
    [workspaceId],
  );

  React.useEffect(() => {
    void load({ day: "", from: "", to: "", userId: "" });
  }, [load]);

  function search(e: React.FormEvent) {
    e.preventDefault();
    void load({ day, from, to, userId });
  }

  function clear() {
    setDay("");
    setFrom("");
    setTo("");
    setUserId("");
    void load({ day: "", from: "", to: "", userId: "" });
  }

  return (
    <section aria-labelledby="checkins-history-title" className="space-y-3">
      <h3 id="checkins-history-title" className="text-sm font-semibold text-fg">
        {ck("checkins.history.title")}
      </h3>
      <form onSubmit={search} className="grid gap-3 sm:grid-cols-4">
        <div>
          <Label>{ck("checkins.history.day")}</Label>
          <Input type="date" dir="ltr" value={day} onChange={(e) => setDay(e.target.value)} aria-label={ck("checkins.history.day")} />
        </div>
        <div>
          <Label>{ck("checkins.history.from")}</Label>
          <Input type="date" dir="ltr" value={from} disabled={!!day} onChange={(e) => setFrom(e.target.value)} aria-label={ck("checkins.history.from")} />
        </div>
        <div>
          <Label>{ck("checkins.history.to")}</Label>
          <Input type="date" dir="ltr" value={to} disabled={!!day} onChange={(e) => setTo(e.target.value)} aria-label={ck("checkins.history.to")} />
        </div>
        <div>
          <Label>{ck("checkins.history.person")}</Label>
          <Select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label={ck("checkins.history.person")}>
            <option value="">{ck("checkins.history.all_people")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2 sm:col-span-4">
          <Button type="submit" size="sm" disabled={busy}>
            {ck("checkins.history.search")}
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={clear}>
            {ck("checkins.history.clear")}
          </Button>
        </div>
      </form>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {ck(error)}
        </p>
      ) : null}
      {data ? <HistoryList data={data} personId={userId || null} /> : error ? null : <p className="text-sm text-fg-muted">{ck("checkins.loading")}</p>}
    </section>
  );
}
