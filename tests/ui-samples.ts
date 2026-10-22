import { createElement, type FunctionComponent, type ReactNode } from "react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetBody, SheetDescription, SheetFooter, SheetHeader, SheetPanel, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPanel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModalContent } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastProvider, ToastRow } from "@/components/ui/toast";
import { InstallHintView } from "@/components/pwa/install-hint";
import Loading from "@/app/(app)/loading";
import { render } from "./ui-render";

const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const noop = () => {};

/**
 * One rendering of every building block of this batch, in every shape it has. The structural tests
 * (logical CSS, theme tokens, Tailwind really generates every class, accessible names) run over all of them.
 */
export function samples(): Record<string, string> {
  const dialogParts = [
    createElement(DialogHeader, { key: "h" }, createElement(DialogTitle, null, "عنوان"), createElement(DialogDescription, null, "وصف")),
    createElement(DialogBody, { key: "b" }, createElement("input", { "aria-label": "حقل" })),
    createElement(DialogFooter, { key: "f" }, createElement("button", { type: "button" }, "حفظ")),
  ];
  const sheetParts = [
    createElement(SheetHeader, { key: "h" }, createElement(SheetTitle, null, "عنوان"), createElement(SheetDescription, null, "وصف")),
    createElement(SheetBody, { key: "b" }, createElement("p", null, "محتوى")),
    createElement(SheetFooter, { key: "f" }, createElement("button", { type: "button" }, "تم")),
  ];
  const menuParts = [
    createElement(DropdownMenuLabel, { key: "l" }, "حسابي"),
    createElement(DropdownMenuItem, { key: "i" }, "الملف الشخصي"),
    createElement(DropdownMenuSeparator, { key: "s" }),
    createElement(DropdownMenuCheckboxItem, { key: "c", checked: true }, "خيار"),
    createElement(
      DropdownMenuRadioGroup,
      { key: "r", value: "a" },
      createElement(DropdownMenuRadioItem, { value: "a" }, "أ"),
      createElement(DropdownMenuRadioItem, { value: "b" }, "ب"),
    ),
    createElement(DropdownMenuItem, { key: "d", tone: "danger" }, "خروج"),
  ];

  return {
    dialog: render(createElement(Dialog, { open: true }, createElement(DialogPanel, null, dialogParts))),
    dialogSizes: ["sm", "md", "lg", "xl"]
      .map((size) => render(createElement(Dialog, { open: true }, createElement(DialogPanel, { size: size as "sm" }, dialogParts))))
      .join("\n"),
    dialogWithOverlay: render(createElement(Dialog, { open: true }, createElement(DialogContent, { portal: false }, dialogParts))),
    modal: render(
      createElement(Dialog, { open: true }, createElement(ModalContent, { title: "عنوان", portal: false, children: createElement("p", null, "محتوى") })),
    ),
    sheetEnd: render(createElement(Sheet, { open: true }, createElement(SheetPanel, null, sheetParts))),
    sheetStart: render(createElement(Sheet, { open: true }, createElement(SheetPanel, { side: "start" }, sheetParts))),
    menu: render(createElement(DropdownMenu, { open: true }, createElement(DropdownMenuTrigger, null, "القائمة"), createElement(DropdownMenuPanel, null, menuParts))),
    spinners: ["sm", "md", "lg"].map((size) => render(createElement(Spinner, { size: size as "sm", label: "جارٍ التحميل…" }))).join("\n") + render(createElement(Spinner)),
    skeleton: render(createElement(Skeleton, { className: "h-4 w-40" })),
    toastStack: render(createElement(Toasts, null, createElement("main", null, "صفحة"))),
    toastRows: (["success", "error", "info"] as const)
      .map((kind) => render(createElement(ToastRow, { item: { id: 1, kind, message: "رسالة" }, onDismiss: noop })))
      .join("\n"),
    installPrompt: render(createElement(InstallHintView, { mode: "prompt", onInstall: noop, onDismiss: noop })),
    installIosSafari: render(createElement(InstallHintView, { mode: "ios-safari", onDismiss: noop })),
    installIosOther: render(createElement(InstallHintView, { mode: "ios-other", onDismiss: noop })),
    loading: render(createElement(Loading)),
  };
}
