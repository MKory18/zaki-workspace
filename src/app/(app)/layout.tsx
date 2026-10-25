import { pageActor } from "@/app/(app)/_access";
import { AppShell } from "@/components/app-shell";
import { audienceOf } from "@/lib/guide/audience";
import { buildNav } from "@/lib/nav/places";
import { newActionsFor } from "@/lib/nav/new-actions";
import { db } from "@/server/db";
import { cookies } from "next/headers";
import { parseSidebarCookie, SIDEBAR_COOKIE } from "@/components/shell/sidebar-cookie";
import { currentSpace } from "@/server/services/current-space";

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
  const subject = { role: actor.role, caps: [...actor.caps] };
  // the company's name under the wordmark: the active organization, nothing else about it
  const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { name: true } });
  // the space the person is in, named at the top of every page (a space is like a separate site)
  const space = await currentSpace(actor);
  return (
    <AppShell
      // the shell draws a name, a username and an e-mail; session facts (tv, locale, onboarding
      // flags) are the server's business and never cross to the browser
      user={{ name: user.name, username: user.username, email: user.email }}
      rank={actor.role}
      isGuest={actor.isExternal}
      nav={buildNav(subject)}
      newActions={actor.isExternal ? [] : newActionsFor(subject)}
      orgName={org?.name}
      space={space ? { id: space.id, name: space.name, emoji: space.emoji } : null}
      canOverview={actor.role === "OWNER" || actor.role === "ADMIN"}
      audience={audienceOf(actor)}
      defaultCollapsed={sidebarCollapsed}
    >
      {children}
    </AppShell>
  );
}
