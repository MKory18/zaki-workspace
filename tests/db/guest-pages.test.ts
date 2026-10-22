import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TelegramPage from "@/app/(app)/telegram/page";
import FilesPage from "@/app/(app)/files/page";
import BoardPage from "@/app/(app)/boards/[id]/page";
import { TelegramView } from "@/components/telegram-view";
import { FilesView } from "@/components/files-view";
import { BoardView } from "@/components/board-view";
import { getServerT } from "@/lib/i18n/server";
import { CUSTOMER_CHAT_TITLE, seedTelegram } from "./guest-helpers";
import { loginAs, makeProject, makeTeam, makeWorkspace } from "./helpers";

// The pages are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

const NOTICE = getServerT().t("guest.no_access");

describe("pages that the API closes to a guest show a notice (and fetch nothing)", () => {
  it("/telegram: a guest never receives the customer chat list the server used to hand to the client", async () => {
    const { org, guest, member } = await makeTeam();
    await seedTelegram(org.id);

    await loginAs(guest.id);
    const element = (await TelegramPage()) as React.ReactElement;
    expect(element.type).not.toBe(TelegramView);
    const html = renderToStaticMarkup(element);
    expect(html).toContain(NOTICE);
    expect(html).not.toContain(CUSTOMER_CHAT_TITLE);
    expect(JSON.stringify(element.props)).not.toContain(CUSTOMER_CHAT_TITLE);

    // everybody else keeps the page (chat titles included, as before)
    await loginAs(member.id);
    const memberElement = (await TelegramPage()) as React.ReactElement;
    expect(memberElement.type).toBe(TelegramView);
    expect(JSON.stringify(memberElement.props)).toContain(CUSTOMER_CHAT_TITLE);
  });

  it("/files: the library view is not rendered for a guest, it still is for members, admins and owners", async () => {
    const { owner, admin, member, guest } = await makeTeam();

    await loginAs(guest.id);
    const guestElement = (await FilesPage()) as React.ReactElement;
    expect(guestElement.type).not.toBe(FilesView);
    expect(renderToStaticMarkup(guestElement)).toContain(NOTICE);

    for (const user of [owner, admin, member]) {
      await loginAs(user.id);
      expect(((await FilesPage()) as React.ReactElement).type).toBe(FilesView);
    }
  });
});

describe("/boards/[id]: the edit controls follow the same rule as the API (canWriteInWorkspace)", () => {
  async function canEditFor(
    orgRole: "owner" | "admin" | "member" | "guest",
    wsRole: "ADMIN" | "MEMBER" | "GUEST" | null,
  ): Promise<boolean> {
    const team = await makeTeam();
    const user = team[orgRole];
    // the OWNER and ADMIN inherit every workspace; give the others an explicit row (or none)
    const ws = await makeWorkspace(team.org.id, wsRole ? [{ userId: user.id, role: wsRole }] : []);
    const { board } = await makeProject(ws.id);
    await loginAs(user.id);
    const element = (await BoardPage({ params: { id: board.id } })) as React.ReactElement<{ canEdit: boolean }>;
    expect(element.type).toBe(BoardView);
    return element.props.canEdit;
  }

  it("a member may edit; a workspace guest row makes even an org member read-only", async () => {
    expect(await canEditFor("member", "MEMBER")).toBe(true);
    expect(await canEditFor("member", "ADMIN")).toBe(true);
    expect(await canEditFor("member", "GUEST")).toBe(false);
  });

  it("an org guest is read-only whatever the workspace row says", async () => {
    expect(await canEditFor("guest", "MEMBER")).toBe(false);
    expect(await canEditFor("guest", "ADMIN")).toBe(false);
    expect(await canEditFor("guest", "GUEST")).toBe(false);
  });

  it("owners and admins outrank any workspace row (they inherit every workspace)", async () => {
    expect(await canEditFor("owner", null)).toBe(true);
    expect(await canEditFor("admin", null)).toBe(true);
    expect(await canEditFor("admin", "GUEST")).toBe(true);
  });
});
