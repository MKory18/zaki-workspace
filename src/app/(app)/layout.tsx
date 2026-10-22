import { pageActor } from "@/app/(app)/_access";
import { AppShell } from "@/components/app-shell";
import { audienceOf } from "@/lib/guide/audience";
import { buildNav } from "@/lib/nav/places";
import { cookies } from "next/headers";
import { parseSidebarCookie, SIDEBAR_COOKIE } from "@/components/shell/sidebar-cookie";

/**
 * The frame of every signed-in page, decided on the server from the DATABASE (behind the middleware,
 * which only sees the cookie):
 *
 *  - nobody signed in, or a cookie that is no longer honoured: to /login;
 *  - somebody who still owes the onboarding (a temporary password, or a notice the owner re-issued
 *    after the cookie was made): to /onboarding;
 *  - everybody else gets the map of THEIR places: the rank and the switches of the oldest ACTIVE
 *    membership (`pageActor`), so an old guest seat that was closed decides nothing.
 *
 * The map only decides what is OFFERED. Every page still refuses for itself (`pageUser` /
 * `pageActor`): in Next 14 a page renders beside its layout, even when the layout redirects.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, actor } = await pageActor();
  // The side menu's folded state is a cookie (`zk-sidebar`), read on the server: the first frame is
  // already the right width, instead of 256px that shrink after the effect runs.
  const sidebarCollapsed = parseSidebarCookie(cookies().get(SIDEBAR_COOKIE)?.value);
  return (
    <AppShell
      user={user}
      rank={actor.role}
      isGuest={actor.isExternal}
      nav={buildNav({ role: actor.role, caps: [...actor.caps] })}
      audience={audienceOf(actor)}
      defaultCollapsed={sidebarCollapsed}
    >
      {children}
    </AppShell>
  );
}
