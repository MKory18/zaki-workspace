import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { CARDS_PLACE, CARDS_SPACE_PLACES, NAV_ROLES, PLACES, buildNav, canOpenPlace, locate, placeOfferedToGuests, type NavModel, type NavRole, type NavSubject } from "@/lib/nav/places";
import { PLACE_KEYS, applyNavOrder, navOrderSchema, readNavOrder, withPlaceOrder } from "@/lib/nav/order";
import { newActionsFor } from "@/lib/nav/new-actions";
import { SPACE_LAYOUTS } from "@/lib/cards/shared";
import { effectiveCapabilities } from "@/server/policy/capabilities";

/**
 * «فقط لوحات» (the owner, 2026-10-30): a space of «لوحات» or «تصنيع» offers «اللوحات» and «الإدارة» and nothing else; a
 * general space has exactly the map it had. The pure map decides, so it is proven here, rank by rank, and composed with
 * the person's saved order and with the company's feature switches.
 */

const who = (role: NavRole, more: Partial<NavSubject> = {}): NavSubject => ({ role, caps: [...effectiveCapabilities({ role })], ...more });
const keys = (nav: NavModel) => nav.places.map((p) => p.key as string);
const CARDS_LAYOUTS = ["CARDS", "MANUFACTURING"] as const;
const STANDARD_SIX = ["today", "chat", "work", "library", "watch", "admin"];

describe("a general space: the map is exactly what it was", () => {
  it("STANDARD and «no layout» draw the same map, for every rank, with and without the switches and the manager flag", () => {
    for (const role of NAV_ROLES) {
      for (const more of [{}, { spaceManager: true }, { off: ["watch" as const] }, { spaceManager: true, off: ["watch" as const] }]) {
        const plain = buildNav(who(role, more));
        expect(buildNav(who(role, { ...more, spaceLayout: "STANDARD" })), `${role} ${JSON.stringify(more)}`).toEqual(plain);
      }
    }
  });

  it("the owner still sees the six places in their order, with the hrefs the menu always had", () => {
    const nav = buildNav(who("OWNER", { spaceLayout: "STANDARD" }));
    expect(keys(nav)).toEqual(STANDARD_SIX);
    expect(nav.places.map((p) => p.href)).toEqual(["/", "/chat", "/my-work", "/files", "/watch", "/members"]);
  });

  it("«اللوحات» is not one of the code's PLACES (their list, their order and the tests that pin them are untouched)", () => {
    expect(PLACES.map((p) => p.key as string)).toEqual(STANDARD_SIX);
    expect(keys(buildNav(who("OWNER")))).not.toContain("cards");
  });
});

describe("a space of «لوحات» or «تصنيع»: «اللوحات» first, then «الإدارة» for whoever may", () => {
  for (const layout of CARDS_LAYOUTS) {
    describe(layout, () => {
      it("the owner: exactly [cards, admin], «اللوحات» first, at the place's own address, named from the dictionary", () => {
        const nav = buildNav(who("OWNER", { spaceLayout: layout }));
        expect(keys(nav)).toEqual(["cards", "admin"]);
        expect(nav.places[0]).toEqual({ key: "cards", href: "/cards", labelKey: "nav.place.cards", icon: "cards", tabs: [] });
        expect(AR["nav.place.cards"]).toBe("اللوحات");
      });

      it("«الإدارة» is the same place, with the same tabs and rules, as in a general space", () => {
        for (const role of NAV_ROLES) {
          for (const spaceManager of [false, true]) {
            const standard = buildNav(who(role, { spaceManager })).places.find((p) => p.key === "admin");
            const cards = buildNav(who(role, { spaceManager, spaceLayout: layout })).places.find((p) => p.key === "admin");
            expect(cards, `${role} manager=${spaceManager}`).toEqual(standard);
          }
        }
      });

      it("a manager of the space gets «المساحة» among the tabs of «الإدارة»; a plain member gets «الفريق» alone", () => {
        const manager = buildNav(who("MEMBER", { spaceManager: true, spaceLayout: layout }));
        expect(manager.places.find((p) => p.key === "admin")?.tabs.map((t) => t.key)).toContain("space");
        const member = buildNav(who("MEMBER", { spaceLayout: layout }));
        expect(keys(member)).toEqual(["cards", "admin"]);
        expect(member.places[1]).toMatchObject({ labelKey: "nav.tab.team", href: "/members" });
      });

      it("every other place is hidden: «اليوم» «الدردشة» «الشغل» «المكتبة» «نتفرّج سوا», for every rank", () => {
        for (const role of NAV_ROLES) {
          const shown = keys(buildNav(who(role, { spaceManager: role !== "GUEST", spaceLayout: layout })));
          for (const hidden of ["today", "chat", "work", "library", "watch"]) expect(shown, `${role} ${hidden}`).not.toContain(hidden);
          expect(shown[0], role).toBe("cards");
        }
      });

      it("an external partner sees «اللوحات» only", () => {
        expect(keys(buildNav(who("GUEST", { spaceLayout: layout })))).toEqual(["cards"]);
        // whatever flag a caller passes, a guest manages nothing and is offered no «الإدارة»
        expect(keys(buildNav(who("GUEST", { spaceLayout: layout, spaceManager: true })))).toEqual(["cards"]);
      });

      it("a person without the directory switch has «اللوحات» alone (the admin place keeps its own rule)", () => {
        const caps = effectiveCapabilities({ role: "MEMBER", revokedCapabilities: ["directory.view"] });
        expect(keys(buildNav({ role: "MEMBER", caps: [...caps], spaceLayout: layout }))).toEqual(["cards"]);
      });

      it("the company's feature switches compose with it: a switched-off place stays hidden, nothing is brought back", () => {
        expect(keys(buildNav(who("OWNER", { spaceLayout: layout, off: ["watch"] })))).toEqual(["cards", "admin"]);
      });

      it("«اللوحات» is a place of one page: no tabs, so there is no tab strip to draw", () => {
        expect(buildNav(who("OWNER", { spaceLayout: layout })).places[0]?.tabs).toEqual([]);
        expect(CARDS_PLACE.tabs).toEqual([]);
      });
    });
  }

  it("what a cards space keeps after «اللوحات» is «الإدارة» alone (the one list the map reads)", () => {
    expect([...CARDS_SPACE_PLACES]).toEqual(["admin"]);
  });

  it("an unknown or damaged layout is a general space (nothing is hidden by a typo)", () => {
    expect(keys(buildNav({ ...who("OWNER"), spaceLayout: "BOARDS" as never }))).toEqual(STANDARD_SIX);
    expect([...SPACE_LAYOUTS]).toEqual(["STANDARD", "CARDS", "MANUFACTURING"]);
  });
});

describe("the routes of the hidden places are not touched", () => {
  it("every address still belongs to its own place, and the cards place owns /cards and /cards/[id]", () => {
    expect(locate("/chat/abc").place).toBe("chat");
    expect(locate("/chat").place).toBe("chat");
    expect(locate("/my-work")).toEqual({ place: "work", tab: "my-work" });
    expect(locate("/tasks/x").place).toBe("work");
    expect(locate("/files").place).toBe("library");
    expect(locate("/watch").place).toBe("watch");
    expect(locate("/")).toEqual({ place: "today", tab: null });
    expect(locate("/cards")).toEqual({ place: "cards", tab: null });
    expect(locate("/cards/abc")).toEqual({ place: "cards", tab: null });
    expect(locate("/cardsx").place).toBe(null);
  });

  it("«اللوحات» is on the map of a cards space only: a partner is offered it there, and never in a general space", () => {
    expect(canOpenPlace(who("GUEST", { spaceLayout: "CARDS" }), "cards")).toBe(true);
    expect(canOpenPlace(who("OWNER"), "cards")).toBe(false);
    expect(placeOfferedToGuests("cards")).toBe(false);
    // the hidden places are not on a cards space's map, though their pages still answer
    expect(canOpenPlace(who("OWNER", { spaceLayout: "CARDS" }), "chat")).toBe(false);
  });

  it("«جديد» follows the map where it asks for a place: «نتفرّج سوا» is not offered inside a cards space, and still is elsewhere", () => {
    const owner = who("OWNER");
    expect(newActionsFor(owner)).toContain("watch");
    expect(newActionsFor({ ...owner, spaceLayout: "CARDS" })).not.toContain("watch");
    expect(newActionsFor({ ...owner, spaceLayout: "STANDARD" })).toEqual(newActionsFor(owner));
  });
});

describe("«ترتيبي» composes with it: an order only reorders what is offered", () => {
  const cardsMap = (role: NavRole = "OWNER") => buildNav(who(role, { spaceLayout: "CARDS" }));
  const standardOrder = { places: ["library", "chat", "today", "work", "watch", "admin"], tabs: {} };

  it("no saved order: «اللوحات» then «الإدارة»", () => {
    expect(keys(applyNavOrder(cardsMap(), null))).toEqual(["cards", "admin"]);
    expect(keys(applyNavOrder(cardsMap(), { places: [], tabs: {} }))).toEqual(["cards", "admin"]);
  });

  it("an order saved in a general space (which never knew «اللوحات») leaves it first; «الإدارة» follows", () => {
    expect(keys(applyNavOrder(cardsMap(), standardOrder))).toEqual(["cards", "admin"]);
    // even an order that put «الإدارة» before the six: «اللوحات» is not in it, so it takes its default first place
    expect(keys(applyNavOrder(cardsMap(), { places: ["admin", "today", "chat", "work", "library", "watch"], tabs: {} }))).toEqual(["cards", "admin"]);
  });

  it("an order saved over the cards map is applied: the person may put «الإدارة» before «اللوحات»", () => {
    expect(keys(applyNavOrder(cardsMap(), { places: ["admin", "cards"], tabs: {} }))).toEqual(["admin", "cards"]);
  });

  it("an order that names «اللوحات» never adds it to a general space, and the six keep the order asked for", () => {
    const nav = buildNav(who("OWNER"));
    const shown = keys(applyNavOrder(nav, { places: ["cards", "admin", "today"], tabs: {} }));
    expect(shown).not.toContain("cards");
    expect(shown.slice().sort()).toEqual(STANDARD_SIX.slice().sort());
    expect(shown[0]).toBe("admin");
  });

  it("a guest's saved order over a cards map is just «اللوحات»", () => {
    expect(keys(applyNavOrder(cardsMap("GUEST"), standardOrder))).toEqual(["cards"]);
  });

  it("the tabs of «الإدارة» are still ordered inside a cards space", () => {
    const order = { places: [], tabs: { admin: ["settings", "team", "reports", "automation", "telegram", "archive"] } };
    const admin = applyNavOrder(cardsMap("OWNER"), order).places.find((p) => p.key === "admin");
    expect(admin?.tabs.slice(0, 2).map((t) => t.key)).toEqual(["settings", "team"]);
  });

  it("the schema and the forgiving reader know «اللوحات», so an order saved in a cards space is accepted and read back", () => {
    expect(PLACE_KEYS).toContain("cards");
    expect(navOrderSchema.safeParse({ places: ["admin", "cards"], tabs: {} }).success).toBe(true);
    expect(readNavOrder({ places: ["admin", "cards", "nope"], tabs: {} })).toEqual({ places: ["admin", "cards"], tabs: {} });
    expect(navOrderSchema.safeParse({ places: ["cards", "cards"], tabs: {} }).success).toBe(false);
    // a list of tabs for the one-page «اللوحات» is still refused
    expect(navOrderSchema.safeParse({ places: [], tabs: { cards: ["x"] } }).success).toBe(false);
  });

  it("a save made in a cards space names only what is offered there", () => {
    expect(withPlaceOrder(null, cardsMap(), ["admin", "cards"]).places).toEqual(["admin", "cards"]);
    expect(withPlaceOrder(null, cardsMap(), ["admin", "chat", "cards"]).places).toEqual(["admin", "cards"]);
  });
});
