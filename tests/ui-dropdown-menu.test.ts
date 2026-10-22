import { createElement, type ComponentProps, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPanel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { classesOf, classTokens, render } from "./ui-render";

/** The avatar menu the shell will build: a label, a link-like item, a theme radio group, a switch, a danger item. */
function items(): ReactElement[] {
  return [
    createElement(DropdownMenuLabel, { key: "l" }, "حسابي"),
    createElement(DropdownMenuItem, { key: "i" }, "الملف الشخصي"),
    createElement(DropdownMenuSeparator, { key: "s" }),
    createElement(DropdownMenuCheckboxItem, { key: "c", checked: true }, "إظهار المكتملة"),
    createElement(DropdownMenuCheckboxItem, { key: "c2", checked: false }, "إخفاء الأرشيف"),
    createElement(
      DropdownMenuRadioGroup,
      { key: "r", value: "calm" },
      createElement(DropdownMenuRadioItem, { value: "calm" }, "إسلامي هادي"),
      createElement(DropdownMenuRadioItem, { value: "day" }, "نهاري"),
    ),
    createElement(DropdownMenuItem, { key: "d", tone: "danger" }, "تسجيل الخروج"),
  ];
}

const menu = (props: ComponentProps<typeof DropdownMenuPanel> = {}) =>
  render(
    createElement(
      DropdownMenu,
      { open: true },
      createElement(DropdownMenuTrigger, null, "القائمة"),
      createElement(DropdownMenuPanel, props, items()),
    ),
  );

describe("DropdownMenu: a keyboard-accessible menu built on Radix", () => {
  it("is a menu with real menu roles and the right states", () => {
    const markup = menu();
    expect(markup).toContain('role="menu"');
    expect(markup.match(/role="menuitem"/g)?.length).toBe(2); // the plain item and the danger item
    expect(markup.match(/role="menuitemcheckbox"/g)?.length).toBe(2);
    expect(markup.match(/role="menuitemradio"/g)?.length).toBe(2);
    expect(markup).toContain('role="separator"');
    expect(markup.match(/aria-checked="true"/g)?.length).toBe(2); // one checked box, one selected radio
    expect(markup.match(/aria-checked="false"/g)?.length).toBe(2);
  });

  it("the trigger announces the menu and its state", () => {
    const trigger = /<button[^>]*>القائمة<\/button>/.exec(menu())?.[0] ?? "";
    expect(trigger).toContain('aria-haspopup="menu"');
    expect(trigger).toContain('aria-expanded="true"');
  });

  it("shows the label, every item and the check / dot indicators", () => {
    const markup = menu();
    for (const text of ["حسابي", "الملف الشخصي", "إظهار المكتملة", "إخفاء الأرشيف", "إسلامي هادي", "نهاري", "تسجيل الخروج"]) {
      expect(markup, text).toContain(text);
    }
    // an indicator is drawn for the checked box and the selected radio only
    expect(markup.match(/<svg[^>]*aria-hidden="true"/g)?.length).toBe(2);
  });

  it("styles the panel with theme tokens, above the page, scrolling inside the available height", () => {
    const classes = classesOf(menu(), /<div[^>]*role="menu"[^>]*>/);
    expect(classes).toEqual(
      expect.arrayContaining([
        "z-50",
        "min-w-[12rem]",
        "rounded-xl",
        "border",
        "border-border",
        "bg-surface-1",
        "text-fg",
        "p-1",
        "shadow-lg",
        "overflow-y-auto",
        "max-h-[var(--radix-dropdown-menu-content-available-height)]",
        "zk-pop",
        "zk-menu",
      ]),
    );
  });

  it("every item is a 44px touch target (36px with a mouse) with a highlight and a keyboard focus ring inside the item", () => {
    const item = classesOf(menu(), /<div[^>]*role="menuitem"[^>]*>/);
    expect(item).toEqual(
      expect.arrayContaining([
        "min-h-11",
        "md:min-h-9",
        "rounded-lg",
        "px-3",
        "data-[highlighted]:bg-accent/10",
        "data-[highlighted]:border-s-accent",
        "data-[disabled]:opacity-50",
        "data-[disabled]:pointer-events-none",
        "focus-visible:ring-inset",
        "outline-none",
      ]),
    );
  });

  it("the danger tone is red text on a red-tinted highlight, from the theme token", () => {
    const danger = classesOf(menu(), /<div[^>]*role="menuitem"[^>]*>تسجيل/);
    expect(danger).toEqual(expect.arrayContaining(["text-danger", "data-[highlighted]:bg-danger/10"]));
  });

  it("checkbox and radio items leave room for the indicator at the START of the line (logical, so it flips in Arabic)", () => {
    const box = classesOf(menu(), /<div[^>]*role="menuitemcheckbox"[^>]*>/);
    expect(box).toEqual(expect.arrayContaining(["ps-8"]));
    const radio = classesOf(menu(), /<div[^>]*role="menuitemradio"[^>]*>/);
    expect(radio).toEqual(expect.arrayContaining(["ps-8"]));
    const indicator = classesOf(menu(), /<span[^>]*start-2[^>]*>/);
    expect(indicator).toEqual(expect.arrayContaining(["absolute", "start-2"]));
  });

  it("the label is quiet text and the separator a hairline", () => {
    const label = classesOf(menu(), /<div[^>]*>حسابي<\/div>/);
    expect(label).toEqual(expect.arrayContaining(["text-xs", "font-semibold", "text-muted"]));
    const separator = classesOf(menu(), /<div[^>]*role="separator"[^>]*>/);
    expect(separator).toEqual(expect.arrayContaining(["h-px", "bg-border"]));
  });

  it("uses logical CSS only: no left/right in any class", () => {
    const offenders = classTokens(menu())
      .map((c) => c.split(":").pop() as string)
      .filter((u) => /^-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|inset-x)(?:-|$)/.test(u));
    expect(offenders).toEqual([]);
  });

  it("reads right-to-left by default (keyboard direction and alignment follow the start side), and can be told otherwise", () => {
    const rtl = DropdownMenu({ children: null }) as ReactElement<{ dir?: string }>;
    expect(rtl.props.dir).toBe("rtl");
    const ltr = DropdownMenu({ dir: "ltr", children: null }) as ReactElement<{ dir?: string }>;
    expect(ltr.props.dir).toBe("ltr");
    // ...and Radix really puts it on the menu
    expect(menu()).toMatch(/role="menu"[^>]*dir="rtl"/);
  });

  it("a closed menu renders only its trigger; DropdownMenuContent mounts in a portal after hydration (nothing on the server)", () => {
    const closed = render(
      createElement(DropdownMenu, { open: false }, createElement(DropdownMenuTrigger, null, "القائمة"), createElement(DropdownMenuPanel, null, items())),
    );
    expect(closed).not.toContain('role="menu"');
    expect(closed).toContain("القائمة");
    const portalled = render(
      createElement(DropdownMenu, { open: true }, createElement(DropdownMenuTrigger, null, "القائمة"), createElement(DropdownMenuContent, null, items())),
    );
    expect(portalled).not.toContain('role="menu"');
    expect(portalled).toContain("القائمة");
  });

  it("DropdownMenuContent without the portal is the same panel", () => {
    const inPlace = render(
      createElement(DropdownMenu, { open: true }, createElement(DropdownMenuTrigger, null, "القائمة"), createElement(DropdownMenuContent, { portal: false }, items())),
    );
    expect(inPlace).toContain('role="menu"');
  });

  it("opens with some distance from its trigger and stays away from the screen edge", () => {
    // the Popper wrapper carries the collision padding as a CSS variable-free style; what is observable on
    // the server is the data attributes of the placement: side and align are set from the props
    const markup = menu({ align: "end" });
    expect(markup).toContain('data-align="end"');
    expect(markup).toContain('data-side="bottom"');
  });
});
