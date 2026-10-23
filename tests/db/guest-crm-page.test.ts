import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CrmPage from "@/app/(app)/crm/page";
import { CrmView } from "@/components/crm-view";
import { getServerT } from "@/lib/i18n/server";
import { loginAs, makeTeam } from "./helpers";

// The page is TSX; under vitest its JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

describe("the /crm page", () => {
  it("shows a guest only the 'not available' notice (the CRM API answers 403, so the view would spin forever)", async () => {
    const { guest } = await makeTeam();
    await loginAs(guest.id);
    const element = (await CrmPage()) as React.ReactElement;
    expect(element.type).not.toBe(CrmView);
    const html = renderToStaticMarkup(element);
    expect(html).toContain(getServerT().t("guest.no_access"));
  });

  it("still renders the CRM view for members, admins and owners", async () => {
    const { owner, admin, member } = await makeTeam();
    for (const user of [owner, admin, member]) {
      await loginAs(user.id);
      const element = (await CrmPage()) as React.ReactElement;
      expect(element.type).toBe(CrmView);
    }
  });
});
