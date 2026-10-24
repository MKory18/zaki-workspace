import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { ARTICLES, articleText } from "@/lib/guide/articles";
import { ARTICLE_AUDIENCE } from "@/lib/guide/audience";
import { matchHelp } from "@/lib/guide/page-help";
import { FIRST_STEPS, stepsFor } from "@/lib/guide/first-steps";

/**
 * The guide describes the chat that exists (review D item 7): spaces and topics for everybody (a guest
 * posts in their spaces' topics), private DMs for the team, the «+» menu, the microphone, the message
 * menu and the read receipts; no «مجموعة» (groups became topics); the conversation page has its own
 * help; and «خطواتك الأولى» asks the team to say hello in «عام».
 */
const chat = ARTICLES.find((a) => a.slug === "chat");

describe("the guide's chat article", () => {
  it("exists, for everyone, and is where the chat and archive pages send people", () => {
    expect(chat).toBeDefined();
    expect(ARTICLE_AUDIENCE.chat).toBe("everyone");
    expect(matchHelp("/chat")?.article).toBe("chat");
    expect(matchHelp("/archive")?.article).toBe("chat");
  });

  it("explains what is on the screen: topics, the «+» menu, the microphone, «⋯» and the long press, who read", () => {
    const staff = articleText(chat!, "staff");
    for (const words of ["مواضيع", "«الشركة»", "«عام»", "«+»", "صورة أو فيديو", "رسالة صوتية", "المايك", "مطوّل", "«⋯»", "✓✓", "آخر رسالة قرأها", "الرقم الأحمر", "الكتم", "المغلق", "المقيّد"]) {
      expect(staff, words).toContain(words);
    }
  });

  it("a guest reads about the topics of their spaces, never about private DMs or the ticks of one", () => {
    const guest = articleText(chat!, "everyone");
    expect(guest).toContain("مواضيع");
    expect(guest).not.toContain("«خاص»");
    expect(guest).not.toContain("رسالة جديدة");
    expect(guest).not.toContain("✓✓");
  });
});

describe("no guide text describes the old chat", () => {
  it("no «واحد لواحد، أو مجموعة», no «مجموعات»: groups became topics", () => {
    const everything = [...ARTICLES.map((a) => articleText(a, "managers")), ...Object.entries(AR).filter(([k]) => /^(guide|tips)\./.test(k)).map(([, v]) => v)].join("\n");
    expect(everything).not.toMatch(/أو مجموعة لفريقك|ومجموعات في مكان واحد/);
    expect(AR["tips.chat"]).toContain("مواضيع لكل مساحة");
  });

  it("the places article gives everybody the chat, and the team their private DMs", () => {
    const places = ARTICLES.find((a) => a.slug === "places")!;
    expect(articleText(places, "everyone")).toContain("الدردشة");
    expect(articleText(places, "staff")).toContain("«خاص»");
  });
});

describe("the conversation page has its own help", () => {
  it("/chat/<id> no longer falls back to the chat home's lines", () => {
    const help = matchHelp("/chat/cv123");
    expect(help?.id).toBe("conversation");
    expect(AR[help!.whatKey]).toContain("المحادثة");
    expect(AR[help!.nextKey]).toContain("مطوّلًا");
  });
});

describe("«خطواتك الأولى»: say hello in «عام»", () => {
  it("the team gets «ابعت أول رسالة بـ«عام»», decided by a message they really sent; a guest does not", () => {
    const step = FIRST_STEPS.find((s) => s.id === "first-message");
    expect(step).toMatchObject({ fact: "message-sent", audience: "staff", href: "/chat" });
    expect(AR[step!.titleKey]).toBe("ابعت أول رسالة بـ«عام»");
    expect(stepsFor("staff").map((s) => s.id)).toContain("first-message");
    expect(stepsFor("everyone").map((s) => s.id)).not.toContain("first-message");
  });
});
