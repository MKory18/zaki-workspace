"use client";

import React from "react";
import { ct } from "@/lib/chat/text";
import { Avatar } from "@/components/ui/avatar";
import { callApi } from "./call-api";

interface Person {
  userId: string;
  user: { id: string; name: string; jobTitle?: string | null; avatarUrl?: string | null };
}

/**
 * «ضيف حدا»: the people of the space (the chat directory, the same list as «رسالة جديدة»), minus whoever is in the
 * call already. A tap rings that person; the server checks again that they are of the call's space.
 */
export function CallInvite({ callId, inCall, onDone, onError }: { callId: string; inCall: string[]; onDone: (name: string) => void; onError: (text: string) => void }) {
  const [people, setPeople] = React.useState<Person[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    void callApi<{ people: Person[] }>("/api/chat/directory").then((r) => setPeople(r.people), () => setPeople([]));
  }, []);

  async function ring(p: Person) {
    setBusy(p.userId);
    try {
      await callApi(`/api/calls/${encodeURIComponent(callId)}/invite`, { userId: p.userId });
      onDone(p.user.name);
    } catch (e) {
      onError(e instanceof Error ? e.message : ct("calls.action_failed"));
    } finally {
      setBusy(null);
    }
  }

  const left = (people ?? []).filter((p) => !inCall.includes(p.userId));
  return (
    <>
      <h2 className="mb-2 font-semibold">{ct("calls.invite_pick")}</h2>
      {people === null ? null : left.length === 0 ? (
        <p className="text-sm text-fg-muted">{ct("calls.invite_none")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {left.map((p) => (
            <li key={p.userId}>
              <button type="button" disabled={busy === p.userId} onClick={() => void ring(p)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-start hover:bg-surface-2 disabled:opacity-60">
                <Avatar name={p.user.name} src={p.user.avatarUrl} className="h-8 w-8" />
                <span className="min-w-0 flex-1 truncate">{p.user.name}</span>
                <span aria-hidden="true">📞</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
