"use client";

import React, { useState } from "react";
import type { SpaceSummaryDto, TopicSummaryDto } from "@/server/chat/dto";
import { ct } from "@/lib/chat/text";
import { dayDiff, fmtShort, fmtTime } from "@/lib/format";
import { NewTopicDialog } from "./new-topic-dialog";

/** Today's last message shows its time, an older one its day (the app's own formatting, src/lib/format.ts). */
function whenOf(at: string): string {
  return dayDiff(at) === 0 ? fmtTime(at) : fmtShort(at);
}

function TopicRow({ topic }: { topic: TopicSummaryDto }) {
  return (
    <li>
      <a
        href={`/chat/${topic.id}`}
        className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-accent/10 text-lg">
          {topic.emoji ?? "💬"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate font-medium">{topic.title}</span>
            {topic.restricted && <span role="img" aria-label={ct("chath.restricted")}>🔒</span>}
            {topic.closed && <span role="img" aria-label={ct("chath.closed")}>🔐</span>}
            {topic.lastMessage && <small className="shrink-0 text-xs text-fg-muted">{whenOf(topic.lastMessage.at)}</small>}
          </span>
          <span className="flex items-center gap-1.5">
            <small className="min-w-0 flex-1 truncate text-sm text-fg-muted">{topic.lastMessage?.preview ?? ct("chath.no_messages")}</small>
            {topic.mentions > 0 && <span className="shrink-0 rounded-full bg-warn/10 px-2 text-xs text-warn">@{topic.mentions}</span>}
            {topic.unread > 0 && (
              <span className="min-w-5 shrink-0 rounded-full bg-accent px-1.5 text-center text-xs font-bold leading-5 text-accent-fg">{topic.unread}</span>
            )}
          </span>
        </span>
      </a>
    </li>
  );
}

/**
 * One space's talk, like a forum group of a messaging app (the owner's picture, 2026-10-25): the space's own
 * topics first, then each «مقطع» it is split into with its topics under its name. A مقطع's topics are its
 * people's and the space's managers' (the server leaves the others out). «موضوع جديد» for the space's ADMIN
 * and the OWNER.
 */
export function SpaceTopics({ space }: { space: SpaceSummaryDto }) {
  const [creating, setCreating] = useState(false);
  const own = space.topics.filter((t) => !t.teamId);
  const groups = space.sections.map((s) => ({ ...s, topics: space.topics.filter((t) => t.teamId === s.id) }));
  return (
    <section aria-labelledby={`space-${space.id}`} className="rounded-2xl border border-border bg-surface-1 p-4">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <h2 id={`space-${space.id}`} className="min-w-0 flex-1 truncate text-lg font-semibold">
          <span aria-hidden="true">{space.emoji ?? "🏢"} </span>
          <bdi>{space.name}</bdi>
          {space.hasExternal && <span className="ms-2 rounded-full bg-info/10 px-2 py-1 text-xs font-normal text-info">{ct("chath.external")}</span>}
        </h2>
        {space.canCreateTopic && (
          <button type="button" onClick={() => setCreating(true)} className="inline-flex min-h-11 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-accent-fg">
            {ct("chath.topic.new")}
          </button>
        )}
      </header>

      {own.length ? <ul className="space-y-0.5">{own.map((t) => <TopicRow key={t.id} topic={t} />)}</ul> : null}
      {!own.length && !groups.some((g) => g.topics.length) && <p className="py-2 text-sm text-fg-muted">{ct("chath.no_topics")}</p>}

      {groups.map((g) => (
        <div key={g.id} className="mt-4">
          <h3 className="mb-1 flex items-center gap-2 px-2 text-xs font-semibold text-fg-muted">
            <span>{ct("chath.section", { name: g.name })}</span>
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
          </h3>
          {g.topics.length ? (
            <ul className="space-y-0.5">{g.topics.map((t) => <TopicRow key={t.id} topic={t} />)}</ul>
          ) : (
            <p className="px-2 py-1 text-sm text-fg-muted">{ct("chath.section.empty")}</p>
          )}
        </div>
      ))}

      {space.canCreateTopic && <NewTopicDialog open={creating} onOpenChange={setCreating} space={space} />}
    </section>
  );
}
