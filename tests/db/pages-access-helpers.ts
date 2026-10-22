import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrgRole } from "@prisma/client";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { db, makeOrg, makeUser } from "./helpers";

/**
 * Fixtures for the "pages and routes honour ACTIVE members and the capability switches" batch.
 * (Kept apart from helpers.ts on purpose: that file belongs to the harness.)
 *
 * A test file that renders a page must mock `next/navigation` itself (`vi.mock` is per file):
 *   redirect -> throws `NEXT_REDIRECT:<to>`, notFound -> throws `NEXT_NOT_FOUND`.
 */

const DAY = 24 * 3600 * 1000;

// The pages are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

/** Renders a server page (inside the client providers its rows need) to static HTML. */
export async function html(page: Promise<ReactElement> | ReactElement): Promise<string> {
  const element = await page;
  return renderToStaticMarkup(
    createElement(
      Translations,
      { initial: "ar" },
      createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, element)),
    ),
  );
}

/** What a server page returned, typed loosely so a test can read the props it handed to its view. */
export type PageElement = ReactElement<Record<string, unknown>>;

/**
 * One person who belongs to TWO companies. Their OLDER membership (the one every
 * "oldest membership" lookup picks first) is suspended or offboarded; the newer one is active.
 * A page or route that forgets to look at the status serves them the wrong company, with the
 * wrong role - which is exactly what these tests catch.
 */
export async function makeTwoCompanyPerson(
  opts: { oldRole?: OrgRole; newRole?: OrgRole; oldStatus?: "SUSPENDED" | "OFFBOARDED" } = {},
) {
  const oldOrg = await makeOrg({ name: "Old company" });
  const newOrg = await makeOrg({ name: "New company" });
  const person = await makeUser({ name: "Works in two companies" });
  await db.organizationMember.create({
    data: {
      organizationId: oldOrg.id,
      userId: person.id,
      role: opts.oldRole ?? "ADMIN",
      status: opts.oldStatus ?? "SUSPENDED",
      createdAt: new Date(Date.now() - 2 * DAY),
    },
  });
  await db.organizationMember.create({
    data: { organizationId: newOrg.id, userId: person.id, role: opts.newRole ?? "MEMBER" },
  });
  const oldOwner = await makeUser({ orgId: oldOrg.id, role: "OWNER", name: "Old company owner" });
  const newOwner = await makeUser({ orgId: newOrg.id, role: "OWNER", name: "New company owner" });
  return { person, oldOrg, newOrg, oldOwner, newOwner };
}

/** Suspends a member by writing the status directly, the way the account service does (optionally ending their sessions). */
export async function suspendMember(orgId: string, userId: string, opts: { endSessions?: boolean } = {}) {
  await db.organizationMember.update({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    data: { status: "SUSPENDED", statusChangedAt: new Date() },
  });
  if (opts.endSessions) await db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}

/** Switches single capabilities on or off for a member row (what the owner does on the members screen). */
export async function setCapabilities(
  orgId: string,
  userId: string,
  caps: { grant?: string[]; revoke?: string[] },
) {
  await db.organizationMember.update({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    data: { capabilities: caps.grant ?? [], revokedCapabilities: caps.revoke ?? [] },
  });
}

/** The person has not finished onboarding: a temporary password is still in place. */
export async function makePending(userId: string) {
  await db.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
}

/** An idea in an organization, created straight in the database. */
export function makeIdea(orgId: string, creatorId: string, title: string) {
  return db.idea.create({ data: { orgId, creatorId, title } });
}

/** A goal in an organization (this week), created straight in the database. */
export function makeGoal(orgId: string, creatorId: string, title: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return db.goal.create({
    data: {
      orgId,
      creatorId,
      title,
      period: "WEEKLY",
      periodStart: start,
      periodEnd: new Date(start.getTime() + 7 * DAY),
    },
  });
}
