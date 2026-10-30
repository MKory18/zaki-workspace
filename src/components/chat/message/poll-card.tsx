"use client";
import React from "react";
import type { MessageDto, PollDto } from "@/server/chat/dto";
import { ct, ctCount } from "@/lib/chat/text";
import { fmtDateTime } from "@/lib/format";
import { choiceAfterTap, errorKeyOf } from "@/lib/chat/poll-client";

/**
 * «استطلاع»: the card a POLL message draws under its question. Counts and percentages for everybody who reads;
 * who chose what only where the server sent it (a poll that is not anonymous, never to a guest). Every control
 * follows what the server said (`canVote`, `canClose`) and the server decides again. The answer to a vote is the
 * message as this person now sees it, so the card redraws from it; a `poll.voted` event makes the screen
 * refetch, which redraws everybody else's.
 */
export function PollCard({ messageId, poll: given, onPoll }: { messageId: string; poll: PollDto; onPoll?: (message: MessageDto) => void }) {
  const [poll, setPoll] = React.useState(given);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => { setPoll(given); }, [given]);

  async function send(path: string, method: "PUT" | "POST", body: unknown, failed: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/chat/messages/${encodeURIComponent(messageId)}/poll/${path}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      if (!response.ok) {
        const key = errorKeyOf(await response.json().catch(() => null));
        throw new Error(key ? ct(key) : ct(failed));
      }
      const message = await response.json() as MessageDto;
      if (message.poll) setPoll(message.poll);
      onPoll?.(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : ct(failed));
    } finally {
      setBusy(false);
    }
  }
  const vote = (optionIds: string[]) => send("vote", "PUT", { optionIds }, "chatc.poll.vote_failed");
  const hasVote = poll.options.some(o => o.mine);
  const kind = poll.multiple ? "chatc.poll.kind.multiple" : "chatc.poll.kind.single";

  return <div data-poll data-closed={poll.closed ? "true" : "false"} className="mt-1.5 w-72 max-w-full space-y-1.5">
   <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
    <span>{ct(kind)}</span>
    {poll.anonymous && <span data-poll-anonymous className="rounded-full bg-info/10 px-1.5 text-info">{ct("chatc.poll.kind.anonymous")}</span>}
    {poll.closed ? <span className="rounded-full bg-warn/10 px-1.5 text-warn">{ct("chatc.poll.closed")}</span> : poll.closesAt && <span>{ct("chatc.poll.closes_at", { when: fmtDateTime(poll.closesAt) })}</span>}
   </p>
   <ul role={poll.multiple ? "group" : "radiogroup"} aria-label={ct("chatc.poll.menu")} className="space-y-1">
    {poll.options.map(option => <li key={option.id}>
     <button type="button" role={poll.multiple ? "checkbox" : "radio"} aria-checked={option.mine} aria-label={ct("chatc.poll.option_aria", { text: option.text, count: option.count, percent: option.percent })} disabled={!poll.canVote || busy} onClick={() => void vote(choiceAfterTap(poll, option.id))} className={`relative flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-lg border px-2.5 text-start text-sm disabled:cursor-default ${option.mine ? "border-accent" : "border-border"}`}>
      <span aria-hidden="true" data-poll-bar className="absolute inset-y-0 start-0 bg-accent/15" style={{ width: `${option.percent}%` }} />
      <span aria-hidden="true" className={`relative flex size-5 shrink-0 items-center justify-center border border-border text-xs ${poll.multiple ? "rounded" : "rounded-full"} ${option.mine ? "bg-accent text-accent-fg" : ""}`}>{option.mine ? "✓" : ""}</span>
      <span className="relative min-w-0 flex-1 break-words">{option.text}</span>
      <span className="relative shrink-0 text-xs tabular-nums text-fg-muted" dir="ltr">{option.count} · {option.percent}%</span>
     </button>
     {option.voters && option.voters.length > 0 && <p data-poll-voters className="px-1 pt-0.5 text-xs text-fg-muted">{ct("chatc.poll.who", { names: option.voters.map(v => v.name).join(ct("chatc.list_sep")) })}</p>}
    </li>)}
   </ul>
   <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
    <span>{ctCount("chatc.poll.voters", poll.voters)}</span>
    {poll.canVote && hasVote && <button type="button" disabled={busy} onClick={() => void vote([])} className="min-h-8 font-semibold text-accent">{ct("chatc.poll.withdraw")}</button>}
    {poll.canClose && <button type="button" disabled={busy} onClick={() => void send("close", "POST", undefined, "chatc.poll.close_failed")} className="min-h-8 font-semibold text-danger">{ct("chatc.poll.close")}</button>}
   </p>
   {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </div>;
}
