"use client";

import React, { useState } from "react";
import type { SpaceSummaryDto, TopicSummaryDto } from "@/server/chat/dto";
import { ct } from "@/lib/chat/text";
import { dayDiff, fmtShort, fmtTime } from "@/lib/format";
import { NewTopicDialog } from "./new-topic-dialog";

import Link from "next/link";
/** Today's last message shows its time, an older one its day (the app's own formatting, src/lib/format.ts). */
function whenOf(at: string): string {
  return dayDiff(at) === 0 ? fmtTime(at) : fmtShort(at);
}

function TopicRow({ topic }: { topic: TopicSummaryDto }) {
  return (
    <li>
      <Link
        href={`/chat/${topic.id}`}
        className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-accent/10 text-lg">
          {topic.emoji ?? "💬"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate font-medium">{topic.title}</span>
            {topic.pinned && <span role="img" aria-label={ct("chath.pinned")}>📌</span>}
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
      </Link>
    </li>
  );
}

type Show = "all" | "unread" | "mentions";
type Kind = "" | TopicSummaryDto["topicType"];

/** The filters a list of topics passes through: unread / mentioning me, one kind, one «مقطع» (or the space's own). */
export function filterTopics(topics: TopicSummaryDto[], f: { show: Show; kind: Kind; section: string }): TopicSummaryDto[] {
  return topics.filter(
    (t) =>
      (f.show === "all" || (f.show === "unread" ? t.unread > 0 : t.mentions > 0)) &&
      (!f.kind || t.topicType === f.kind) &&
      (!f.section || (f.section === "space" ? !t.teamId : t.teamId === f.section)),
  );
}

/**
 * One space's talk, like a forum group of a messaging app (the owner's picture, 2026-10-25): the space's own
 * topics first, then each «مقطع» it is split into with its topics under its name. A مقطع's topics are its
 * people's and the space's managers' (the server leaves the others out). «موضوع جديد» for the space's ADMIN
 * and the OWNER. Pinned topics come first (the server's order); the filters narrow the list (unread, mentioning me,
 * a kind, a مقطع); the archived topics (the managers get them) wait folded under «المؤرشفة».
 */
export function SpaceTopics({ space }: { space: SpaceSummaryDto }) {
  const [creating, setCreating] = useState(false);
  const [show, setShow] = useState<Show>("all");
  const [kind, setKind] = useState<Kind>("");
  const [section, setSection] = useState("");
  const live = space.topics.filter((t) => !t.archived);
  const archived = space.topics.filter((t) => t.archived);
  const filtering = show !== "all" || !!kind || !!section;
  const shown = filterTopics(live, { show, kind, section });
  const kinds = [...new Set(live.map((t) => t.topicType))];
  const own = section && section !== "space" ? [] : shown.filter((t) => !t.teamId);
  const groups = space.sections
    .filter((s) => !section || section === s.id)
    .map((s) => ({ ...s, topics: shown.filter((t) => t.teamId === s.id) }))
    // while filtering, a مقطع with nothing that passes is left out (not «no topics yet»)
    .filter((g) => !filtering || g.topics.length > 0);
  const chip = "inline-flex min-h-9 items-center rounded-full border border-border px-3 text-sm aria-pressed:border-accent aria-pressed:bg-accent/10";
  const select = "h-9 rounded-lg border border-muted bg-surface px-2 text-sm";
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

      {live.length > 1 && (
        <div role="group" aria-label={ct("chath.filter.label")} className="mb-2 flex flex-wrap items-center gap-2">
          {(["all", "unread", "mentions"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={show === v} onClick={() => setShow(v)} className={chip}>
              {ct(`chath.filter.${v}`)}
            </button>
          ))}
          {kinds.length > 1 && (
            <select aria-label={ct("chath.filter.kind")} value={kind} onChange={(e) => setKind(e.currentTarget.value as Kind)} className={select}>
              <option value="">{ct("chath.filter.kind_all")}</option>
              {kinds.map((k) => (
                <option key={k} value={k}>{ct(`chath.topic.type.${k}`)}</option>
              ))}
            </select>
          )}
          {space.sections.length > 0 && (
            <select aria-label={ct("chath.filter.section")} value={section} onChange={(e) => setSection(e.currentTarget.value)} className={select}>
              <option value="">{ct("chath.filter.section_all")}</option>
              <option value="space">{ct("chath.filter.section_space")}</option>
              {space.sections.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {own.length ? <ul className="space-y-0.5">{own.map((t) => <TopicRow key={t.id} topic={t} />)}</ul> : null}
      {!own.length && !groups.some((g) => g.topics.length) && (
        <p className="py-2 text-sm text-fg-muted">{ct(filtering ? "chath.filter.none" : "chath.no_topics")}</p>
      )}

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

      {archived.length > 0 && (
        <details className="mt-4">
          <summary className="flex min-h-11 cursor-pointer items-center px-2 text-sm font-semibold text-fg-muted">
            {ct("chath.archived", { n: archived.length })}
          </summary>
          <ul className="space-y-0.5 opacity-80">{archived.map((t) => <TopicRow key={t.id} topic={t} />)}</ul>
        </details>
      )}

      {space.canCreateTopic && <NewTopicDialog open={creating} onOpenChange={setCreating} space={space} />}
    </section>
  );
}
