import { createElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "@/components/ui/sheet";
import { Modal, ModalContent, whenClosed } from "@/components/ui/modal";
import { classesOf, classTokens, render } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const noop = () => {};

// ---------------------------------------------------------------- Dialog

/** A typical form dialog: header (title + description), a body with a field, a footer. */
function formParts(): ReactElement[] {
  return [
    createElement(
      DialogHeader,
      { key: "h" },
      createElement(DialogTitle, null, "إضافة شخص"),
      createElement(DialogDescription, null, "أدخل بيانات الشخص الجديد"),
    ),
    createElement(DialogBody, { key: "b" }, createElement("input", { "aria-label": "الاسم" })),
    createElement(DialogFooter, { key: "f" }, createElement("button", { type: "button" }, "حفظ")),
  ];
}

const dialog = (props: ComponentProps<typeof DialogPanel> = {}, parts: ReactNode = formParts()) =>
  render(createElement(Dialog, { open: true }, createElement(DialogPanel, props, parts)));

describe("Dialog: the accessible centred dialog built on Radix", () => {
  it("is a real modal dialog: role, aria-modal, open state and a focus scope", () => {
    const markup = dialog();
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('data-state="open"');
    // Radix's focus scope makes its container focusable by script (tabindex -1): proof the trap is in place
    expect(markup).toContain('tabindex="-1"');
  });

  it("renders the title as a heading and the description as text", () => {
    const markup = dialog();
    expect(markup).toMatch(/<h2[^>]*>إضافة شخص<\/h2>/);
    expect(markup).toMatch(/<p[^>]*>أدخل بيانات الشخص الجديد<\/p>/);
  });

  it("closes with a button named in Arabic that is a 44px target", () => {
    const markup = dialog();
    const close = /<button[^>]*aria-label="إغلاق"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(close).not.toBe("");
    expect(classesOf(close, /<button[^>]*>/)).toEqual(expect.arrayContaining(["size-11"]));
    expect(markup).not.toContain('aria-label="Close"');
  });

  it("puts the close button AFTER the body, so the first thing focused is the first field and not the X", () => {
    const markup = dialog();
    expect(markup.indexOf('aria-label="الاسم"')).toBeGreaterThan(-1);
    expect(markup.lastIndexOf('aria-label="إغلاق"')).toBeGreaterThan(markup.indexOf('aria-label="الاسم"'));
    // ...and visually it sits in the corner at the end of the line
    expect(classesOf(markup, /<button[^>]*aria-label="إغلاق"[^>]*>/)).toEqual(expect.arrayContaining(["absolute", "end-2", "top-2"]));
  });

  it("can leave out the corner button when the dialog offers its own way out", () => {
    expect(dialog({ hideClose: true })).not.toContain('aria-label="إغلاق"');
  });

  it("sits in the middle without a transform, keeps 16px gutters and scrolls instead of overflowing", () => {
    const classes = classesOf(dialog(), /<div[^>]*role="dialog"[^>]*>/);
    expect(classes).toEqual(
      expect.arrayContaining(["fixed", "inset-0", "m-auto", "h-fit", "max-h-[calc(100dvh-2rem)]", "w-[calc(100%-2rem)]", "max-w-md", "overflow-y-auto"]),
    );
    // a transform-based centring would fight the entrance animation
    expect(classes.some((c) => /translate/.test(c))).toBe(false);
  });

  it("has sizes", () => {
    expect(classesOf(dialog({ size: "sm" }), /<div[^>]*role="dialog"[^>]*>/)).toContain("max-w-sm");
    expect(classesOf(dialog({ size: "lg" }), /<div[^>]*role="dialog"[^>]*>/)).toContain("max-w-lg");
    expect(classesOf(dialog({ size: "xl" }), /<div[^>]*role="dialog"[^>]*>/)).toContain("max-w-2xl");
  });

  it("takes its colours from the theme tokens", () => {
    const classes = classesOf(dialog(), /<div[^>]*role="dialog"[^>]*>/);
    // a floating panel is an elevated card: surface-1 (white on the calm theme), like Card
    expect(classes).toEqual(expect.arrayContaining(["bg-surface-1", "text-fg", "border-border"]));
  });

  it("a dark theme's panel keeps a visible edge on the dimmed page (the page and the panel are too close to separate by tone alone)", () => {
    // the panel draws a 1px edge in `muted`: on the two dark themes surface-1 vs the scrim-dimmed
    // page is only ~1.2:1, so the edge — not the fill — is what shows where the dialog starts.
    const classes = classesOf(dialog(), /<div[^>]*role="dialog"[^>]*>/);
    expect(classes).toEqual(expect.arrayContaining(["ring-1", "ring-muted"]));
    const sheet = sheetClasses();
    expect(sheet).toEqual(expect.arrayContaining(["ring-1", "ring-muted"]));
  });

  it("drops the focus ring on the panel itself (the fields and buttons inside keep theirs)", () => {
    const classes = classesOf(dialog(), /<div[^>]*role="dialog"[^>]*>/);
    expect(classes).toEqual(expect.arrayContaining(["focus:outline-none", "focus-visible:ring-0"]));
  });

  it("a closed dialog renders nothing", () => {
    expect(render(createElement(Dialog, { open: false }, createElement(DialogPanel, null, formParts())))).toBe("");
  });

  it("DialogContent mounts in a portal after hydration: the server renders nothing and does not throw", () => {
    expect(render(createElement(Dialog, { open: true }, createElement(DialogContent, null, formParts())))).toBe("");
  });

  it("DialogContent without the portal draws the dimming overlay (the theme's dark scrim at 60%, fading) and the panel in place", () => {
    const markup = render(createElement(Dialog, { open: true }, createElement(DialogContent, { portal: false }, formParts())));
    const overlay = classesOf(markup, /<div[^>]*zk-fade[^>]*>/);
    // the scrim is a DARK veil in every theme (palettes.ts): a theme token, no plain black
    expect(overlay).toEqual(expect.arrayContaining(["fixed", "inset-0", "z-50", "bg-scrim/60"]));
    expect(overlay).not.toContain("bg-black/50");
    expect(markup).toContain('role="dialog"');
    // the overlay comes first so the panel is painted above it
    expect(markup.indexOf("zk-fade")).toBeLessThan(markup.indexOf('role="dialog"'));
  });

  it("the panel enters and leaves with the shared pop animation", () => {
    expect(classesOf(dialog(), /<div[^>]*role="dialog"[^>]*>/)).toContain("zk-pop");
  });
});

describe("focus goes back to whoever opened a dialog or a sheet (Radix only knows its own Trigger; a Modal is opened from state)", () => {
  // the behaviour itself is tested in tests/ui-focus-return.test.ts; a server render cannot close a dialog,
  // so what is pinned here is that both panels are wired to it
  it.each(["dialog", "sheet"])("%s.tsx passes the caller's own close-focus handler through useReturnFocus and mounts its note-the-opener child first in the panel", (file) => {
    const source = read(`src/components/ui/${file}.tsx`);
    expect(source).toMatch(/useReturnFocus\(\s*onCloseAutoFocus\s*\)/);
    expect(source).toMatch(/onCloseAutoFocus=\{returnFocus\.onCloseAutoFocus\}/);
    expect(source).toContain("{returnFocus.noteOpener}");
  });

  it("the opener is noted while the content renders (it exists only while the dialog is open, and an autoFocus field has not yet taken focus) and given back on close", () => {
    const source = read("src/components/ui/dialog.tsx");
    expect(source).toMatch(/React\.useState\(\(\) => \{\s*into\.current = rememberFocus\(/);
    expect(source).toContain("restoreFocus(target, event)");
  });
});

// ---------------------------------------------------------------- Sheet

function sheetParts(): ReactElement[] {
  return [
    createElement(
      SheetHeader,
      { key: "h" },
      createElement(SheetTitle, null, "المساحات"),
      createElement(SheetDescription, null, "اختر مساحة العمل"),
    ),
    createElement(SheetBody, { key: "b" }, createElement("p", null, "المحتوى")),
    createElement(SheetFooter, { key: "f" }, createElement("button", { type: "button" }, "تم")),
  ];
}

const sheet = (props: ComponentProps<typeof SheetPanel> = {}) =>
  render(createElement(Sheet, { open: true }, createElement(SheetPanel, props, sheetParts())));

const sheetClasses = (props: ComponentProps<typeof SheetPanel> = {}) => classesOf(sheet(props), /<div[^>]*role="dialog"[^>]*>/);

describe("Sheet: a bottom sheet on phones, a side panel on desktop", () => {
  it("is a real modal dialog", () => {
    const markup = sheet();
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('data-state="open"');
  });

  it("phone: pinned to the bottom, full width, rounded top, at most 85% of the screen, with safe-area padding", () => {
    expect(sheetClasses()).toEqual(
      expect.arrayContaining([
        "fixed",
        "bottom-0",
        "start-0",
        "end-0",
        "flex",
        "flex-col",
        "max-h-[85dvh]",
        "rounded-t-2xl",
        "border-t",
        "pb-[env(safe-area-inset-bottom)]",
        "bg-surface-1",
        "text-fg",
        "border-border",
        "z-50",
      ]),
    );
  });

  it("phone: no drag-handle grabber (it did nothing — a false affordance removed in the fix wave)", () => {
    expect(sheet()).not.toMatch(/<span[^>]*aria-hidden="true"[^>]*md:hidden[^>]*>/);
  });

  it("desktop: a 28rem panel on the END side (the left in Arabic), full height, no bottom-sheet shape", () => {
    expect(sheetClasses()).toEqual(
      expect.arrayContaining([
        "md:top-0",
        "md:start-auto",
        "md:end-0",
        "md:w-[28rem]",
        "md:max-h-none",
        "md:rounded-none",
        "md:rounded-s-2xl",
        "md:border-s",
        "md:border-t-0",
        "zk-sheet",
        "zk-sheet-end",
      ]),
    );
  });

  it("desktop: can open from the START side instead", () => {
    const classes = sheetClasses({ side: "start" });
    expect(classes).toEqual(expect.arrayContaining(["md:start-0", "md:end-auto", "md:rounded-e-2xl", "md:border-e", "zk-sheet-start"]));
    expect(classes).not.toContain("md:end-0");
    expect(classes).not.toContain("zk-sheet-end");
  });

  it("desktop: keeps the safe areas at the top and the bottom", () => {
    expect(sheetClasses()).toEqual(expect.arrayContaining(["md:pt-[env(safe-area-inset-top)]"]));
  });

  it("uses logical CSS only: no left/right in any class", () => {
    for (const side of ["end", "start"] as const) {
      const offenders = classTokens(sheet({ side }))
        .map((c) => c.split(":").pop() as string)
        .filter((u) => /^-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|inset-x)(?:-|$)/.test(u));
      expect(offenders).toEqual([]);
    }
  });

  it("closes with a button named in Arabic that is a 44px target, placed after the content", () => {
    const markup = sheet();
    expect(markup).toContain('aria-label="إغلاق"');
    expect(classesOf(markup, /<button[^>]*aria-label="إغلاق"[^>]*>/)).toEqual(expect.arrayContaining(["size-11", "end-2", "top-2"]));
    expect(markup.lastIndexOf('aria-label="إغلاق"')).toBeGreaterThan(markup.indexOf("المحتوى"));
  });

  it("the body scrolls inside the sheet and does not drag the page along", () => {
    const body = classesOf(sheet(), /<div[^>]*><p>المحتوى<\/p><\/div>/);
    expect(body).toEqual(expect.arrayContaining(["min-h-0", "flex-1", "overflow-y-auto", "overscroll-contain"]));
  });

  it("a closed sheet renders nothing; SheetContent mounts in a portal after hydration (nothing on the server)", () => {
    expect(render(createElement(Sheet, { open: false }, createElement(SheetPanel, null, sheetParts())))).toBe("");
    expect(render(createElement(Sheet, { open: true }, createElement(SheetContent, null, sheetParts())))).toBe("");
  });

  it("SheetContent without the portal draws the overlay and the panel", () => {
    const markup = render(createElement(Sheet, { open: true }, createElement(SheetContent, { portal: false }, sheetParts())));
    expect(markup).toContain("bg-scrim/60");
    expect(markup).toContain('role="dialog"');
  });
});

// ---------------------------------------------------------------- Modal

describe("Modal: the same props, new insides", () => {
  it("keeps the exact props every call site uses (checked by tsc as well)", () => {
    expectTypeOf<ComponentProps<typeof Modal>>().toEqualTypeOf<{
      open: boolean;
      title: string;
      onClose: () => void;
      children: ReactNode;
    }>();
    expect(typeof Modal).toBe("function");
  });

  it("renders nothing when closed", () => {
    expect(render(createElement(Modal, { open: false, title: "عنوان", onClose: noop, children: "المحتوى" }))).toBe("");
  });

  it("an open Modal lives in a portal: the server renders nothing for it (it mounts after hydration) and does not throw", () => {
    expect(render(createElement(Modal, { open: true, title: "عنوان", onClose: noop, children: "المحتوى" }))).toBe("");
  });

  it("its panel: the title as the dialog's name and heading, the children in the body, the close button in Arabic", () => {
    const markup = render(
      createElement(
        Dialog,
        { open: true },
        createElement(ModalContent, { title: "إنشاء مشروع", portal: false, children: createElement("p", null, "المحتوى") }),
      ),
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="إنشاء مشروع"');
    expect(markup).toMatch(/<h2[^>]*>إنشاء مشروع<\/h2>/);
    expect(markup).toContain("المحتوى");
    expect(markup).toContain('aria-label="إغلاق"');
    expect(markup).not.toContain('aria-label="Close"');
    expect(markup).not.toContain("✕");
  });

  it("is built on the shared Dialog: no private overlay and no private Escape handler any more", () => {
    const source = read("src/components/ui/modal.tsx");
    expect(source).toMatch(/from "@\/components\/ui\/dialog"/);
    expect(source).not.toContain("addEventListener");
    expect(source).not.toContain("fixed inset-0");
  });

  it("calls onClose when the dialog asks to close, and never when it opens (the call sites decide what closing means)", () => {
    const calls: string[] = [];
    const handler = whenClosed(() => calls.push("closed"));
    handler(true);
    expect(calls).toEqual([]);
    handler(false);
    expect(calls).toEqual(["closed"]);
  });
});
