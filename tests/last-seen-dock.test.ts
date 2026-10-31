import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

(globalThis as { React?: typeof React }).React = React;

import { PeopleDock, type PresenceRosterDto } from "@/components/shell/people-dock";
import { QuickChat, type QuickChatPeopleDto } from "@/components/shell/quick-chat";
import { I18nProvider } from "@/lib/i18n";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

/**
 * «آخر ظهور» on the two lists of people (the owner, 2026-10-31): the dock's row and the quick chat's row print the last
 * seen text where «غير متصل» used to be; an answer that carries no `lastSeenAt` (the switch is off, an older server) keeps
 * the old words, byte for byte.
 */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function dock(data: PresenceRosterDto): string {
  const client = new QueryClient();
  client.setQueryData(["presence-dock", "space"], data);
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(PeopleDock, { enabled: true, defaultOpen: true }))));
}

function quick(data: QuickChatPeopleDto): string {
  const client = new QueryClient();
  client.setQueryData(["quick-chat-people"], data);
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(QuickChat, { enabled: true, defaultOpen: true }))));
}

describe("the people dock row", () => {
  const withSeen: PresenceRosterDto = {
    timeZone: "Asia/Damascus",
    people: [
      { userId: "u1", name: "سلمى عبيد", jobTitle: "محاسبة", role: "MEMBER", online: true, lastSeenAt: ago(0) },
      { userId: "u2", name: "ليان مراد", jobTitle: null, role: "MEMBER", online: false, lastSeenAt: ago(5) },
      { userId: "u3", name: "عمر خالد", jobTitle: null, role: "MEMBER", online: false, lastSeenAt: null },
    ],
    onlineCount: 1,
    total: 3,
  };

  it("prints «متصل الآن», «آخر ظهور قبل 5 دقايق» and «غير معروف» instead of «غير متصل»", () => {
    const out = dock(withSeen);
    expect(out).toContain("data-last-seen");
    expect(out).toContain("متصل الآن");
    expect(out).toContain("آخر ظهور قبل 5 دقايق");
    expect(out).toContain("غير معروف");
    expect(out).not.toContain("غير متصل");
  });

  it("without the field the row keeps «غير متصل» and «متصل» exactly as before", () => {
    const out = dock({
      people: [
        { userId: "u1", name: "سلمى عبيد", jobTitle: null, role: "MEMBER", online: true },
        { userId: "u2", name: "ليان مراد", jobTitle: null, role: "MEMBER", online: false },
      ],
      onlineCount: 1,
      total: 2,
    });
    expect(out).toContain("غير متصل");
    expect(out).toContain(">متصل<");
    expect(out).not.toContain("آخر ظهور");
    expect(out).not.toContain("متصل الآن");
  });
});

describe("the quick chat row", () => {
  it("prints the last seen at the end of each row", () => {
    const out = quick({
      timeZone: "Asia/Damascus",
      people: [
        { userId: "u1", role: "MEMBER", inSpace: true, online: true, lastSeenAt: ago(0), user: { id: "u1", name: "سلمى عبيد", jobTitle: null, avatarUrl: null } },
        { userId: "u2", role: "MEMBER", inSpace: true, online: false, lastSeenAt: ago(3), user: { id: "u2", name: "ليان مراد", jobTitle: null, avatarUrl: null } },
      ],
    });
    expect(out).toContain("متصل الآن");
    expect(out).toContain("آخر ظهور قبل 3 دقايق");
  });

  it("without the field the list is as it was: no last seen text at all", () => {
    const out = quick({
      people: [{ userId: "u2", role: "MEMBER", inSpace: true, online: false, user: { id: "u2", name: "ليان مراد", jobTitle: null, avatarUrl: null } }],
    });
    expect(out).not.toContain("data-last-seen");
    expect(out).not.toContain("آخر ظهور");
  });
});
