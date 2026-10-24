"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import type { Audience } from "@/lib/guide/audience";
import { browserStore } from "@/lib/guide/storage";
import { locate, type NavModel, type NavRole } from "@/lib/nav/places";
import type { AvatarUser } from "@/components/shell/avatar-menu";
import { DolphinMark } from "@/components/logo";
import { BottomNav } from "@/components/shell/bottom-nav";
import { PlaceTabs } from "@/components/shell/place-tabs";
import { Sidebar } from "@/components/shell/sidebar";
import { SpaceSwitcher } from "@/components/shell/space-switcher";
import { TopBar } from "@/components/shell/top-bar";
import { readSidebarCollapsed, writeSidebarCollapsed } from "@/components/shell/sidebar-state";
import { useChatUnread } from "@/lib/chat/use-chat-unread";
import { parseSidebarCookie, writeSidebarCookie } from "@/components/shell/sidebar-cookie";

export interface AppShellProps {
  user: AvatarUser;
  /** The person's map, computed on the server from their rank and switches (src/lib/nav/places.ts). */
  nav: NavModel;
  /** The rank in the active organization, shown in Arabic in the avatar menu. */
  rank: NavRole;
  /** The guide level («؟» picks the read-only line for an external partner). */
  audience: Audience;
  /** An external partner: never offered to open a space. */
  isGuest?: boolean;
  /** What the server read from the `zk-sidebar` cookie: the first frame is already the right width. */
  defaultCollapsed?: boolean;
  children: ReactNode;
}

/**
 * THE FRAME OF EVERY SIGNED-IN PAGE — the five places of the owner's plan, mobile first, right to left.
 *
 *   phone (< md)       the top bar (mark, search, «؟», bell, avatar), the tab strip of the current place,
 *                      the page, and the places in a bar fixed along the bottom (no side menu).
 *   computer (>= md)   the side menu on the start side (the places, the spaces, the avatar; it folds to
 *                      an icon rail and remembers that on this device), the top bar (search, «؟», bell),
 *                      the tab strip, the page.
 *
 * Both the bottom bar and the side menu are in the page; CSS shows one. The map comes from the server
 * (`buildNav` in the (app) layout): the frame only draws it, and the server still decides every request.
 * Theme tokens only, logical CSS only; the decoration is in the side menu's header and nowhere else.
 */
export function AppShell({ user, nav, rank, audience, isGuest = false, defaultCollapsed = false, children }: AppShellProps) {
  const { t } = useI18n();
  const pathname = usePathname() ?? "/";
  const here = locate(pathname);
  // a page of a place this person is not offered (a guest who typed /files) marks nothing
  const place = nav.places.find((p) => p.key === here.place) ?? null;
  const tab = place && place.tabs.some((x) => x.key === here.tab) ? here.tab : null;
  // the unread messages behind «الدردشة», on every page (only when the chat is one of this person's places)
  const chatUnread = useChatUnread(nav.places.some((p) => p.key === "chat"));
  const badges = { chat: chatUnread };

  // The folded state starts from the `zk-sidebar` COOKIE the server layout read: no 256px flash and
  // no animated shrink after the first paint. localStorage stays as a second memory for a device
  // whose cookies were cleared, and is only honoured when it DISAGREES after the page has loaded.
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  // the width only animates once the person has toggled the menu in this visit — never on first paint
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    const stored = readSidebarCollapsed(browserStore());
    if (stored !== defaultCollapsed) setCollapsed(stored);
    // the cookie is the truth from now on; this only back-fills a device whose cookie was lost
    writeSidebarCookie(stored || defaultCollapsed ? true : false, document);
  }, [defaultCollapsed]);
  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    setAnimated(true);
    writeSidebarCollapsed(browserStore(), next);
    writeSidebarCookie(next, document);
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
      <a
        href="#zk-main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-[100] focus:rounded-xl focus:bg-surface-1 focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-fg focus:shadow-lg"
      >
        {t("shell.skip")}
      </a>

      <Sidebar
        nav={nav}
        current={place?.key ?? null}
        pathname={pathname}
        user={user}
        rank={rank}
        isGuest={isGuest}
        collapsed={collapsed}
        onToggle={toggleSidebar}
        animated={animated}
        badges={badges}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar nav={nav} pathname={pathname} audience={audience} user={user} rank={rank} />
        <PlaceTabs
          place={place}
          tab={tab}
          pathname={pathname}
          end={
            place?.key === "work" ? (
              <div className="shrink-0 border-s border-border px-1 md:hidden">
                <SpaceSwitcher variant="strip" isGuest={isGuest} />
              </div>
            ) : null
          }
        />
        {/* on a phone the content stops above the fixed bottom bar (its 56px, its border and the home-indicator inset) */}
        <div className="flex min-h-0 flex-1 pb-[calc(3.5rem+1px+env(safe-area-inset-bottom))] md:pb-0">
          <main id="zk-main" tabIndex={-1} className="zk-safe-x min-w-0 flex-1 overflow-y-auto focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
            {children}
          </main>
        </div>
      </div>

      <BottomNav places={nav.places} current={place?.key ?? null} pathname={pathname} badges={badges} />
    </div>
  );
}
