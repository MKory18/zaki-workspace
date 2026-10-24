import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/chat/c1",
}));

import ChatConversationPage from "@/app/(app)/chat/[id]/page";
import { ConversationPageClient } from "@/components/chat/conversation/conversation-page-client";
import { loginAs, logout, makeTeam } from "./helpers";

type PageElement = { type: unknown; props: Record<string, unknown> };

describe("/chat/[id] is the conversation screen, not a placeholder", () => {
  it("a signed-in person gets the conversation screen for that id", async () => {
    const team = await makeTeam();
    for (const who of [team.member, team.guest]) {
      await loginAs(who.id);
      const element = (await ChatConversationPage({ params: { id: "cv_123" } })) as PageElement;
      expect(element.type).toBe(ConversationPageClient);
      expect(element.props).toEqual({ conversationId: "cv_123" });
    }
  });

  it("draws the message log and never the old «قيد التجهيز» text or the raw id", () => {
    const html = renderToStaticMarkup(createElement(ConversationPageClient, { conversationId: "cv_123" }));
    expect(html).toContain("role=\"log\"");
    expect(html).toContain("data-conversation-id=\"cv_123\"");
    expect(html).not.toContain("قيد التجهيز");
    expect(html).not.toMatch(/<p[^>]*>cv_123<\/p>/);
  });

  it("an anonymous visitor is sent to sign in", async () => {
    logout();
    await expect(ChatConversationPage({ params: { id: "cv_123" } })).rejects.toThrow(/NEXT_REDIRECT/);
  });
});
