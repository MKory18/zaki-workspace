"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { FileText, FolderKanban, MessageCircle, Plus, SquareCheck, UserPlus, UsersRound, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * «جديد» — the gold button and its wheel, as in the owner's adopted mockup: six actions around a
 * gold ring, opened over the page and closed with Esc, the backdrop or «×».
 *
 * It is a navigation wheel, not a form: «مهمّة» puts the cursor in the quick-add field of «اليوم»
 * (or takes you there), «مشروع» opens the projects, «مستند» the library, «رسالة» the chat,
 * «فريق»/«عضو» the people. Those are the app's own screens; the wheel only shortens the way to them.
 */
const ITEMS = [
  { key: "task", icon: SquareCheck, href: "/" },
  { key: "project", icon: FolderKanban, href: "/projects" },
  { key: "doc", icon: FileText, href: "/files" },
  { key: "msg", icon: MessageCircle, href: "/chat" },
  { key: "team", icon: UsersRound, href: "/members" },
  { key: "member", icon: UserPlus, href: "/members" },
] as const;

/** The quick-add field of «اليوم» (src/components/today/quick-add.tsx), if the page is showing it. */
const QUICK_ADD_ID = "zk-quick-add";

export function NewWheel() {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const first = useRef<HTMLButtonElement | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    opener.current?.focus();
  }

  function go(item: (typeof ITEMS)[number]) {
    setOpen(false);
    if (item.key === "task") {
      const field = document.getElementById(QUICK_ADD_ID);
      if (field) {
        field.scrollIntoView({ block: "center", behavior: "smooth" });
        field.focus();
        return;
      }
    }
    router.push(item.href);
  }

  return (
    <>
      <button
        ref={opener}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-accent-2 px-4 text-sm font-bold text-scrim transition-[filter] hover:brightness-110"
      >
        <Plus aria-hidden="true" className="size-5" strokeWidth={2.4} />
        {t("shell.new")}
      </button>

      {open ? (
        <div role="presentation" onClick={close} className="fixed inset-0 z-50 bg-scrim/60">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.new.title")}
            onClick={(event) => event.stopPropagation()}
            className="absolute top-[66px] size-[330px] end-[18px] max-sm:start-1/2 max-sm:end-auto max-sm:-translate-x-1/2"
          >
            <div aria-hidden="true" className="zk-wheel-ring absolute inset-0" />

            <div className="pointer-events-none absolute start-1/2 top-1/2 w-[118px] -translate-x-1/2 -translate-y-1/2 text-center">
              <b className="block font-display text-base leading-6 text-fg">{t("shell.new.title")}</b>
              <small className="text-xs text-fg-muted">{t("shell.new.close_hint")}</small>
            </div>

            {ITEMS.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={`${item.key}-${item.href}`}
                  ref={index === 0 ? first : undefined}
                  type="button"
                  onClick={() => go(item)}
                  style={{ "--i": index } as CSSProperties}
                  className="zk-wheel-item absolute start-1/2 top-1/2 -ms-[42px] -mt-[42px] flex size-[84px] flex-col items-center justify-center gap-1 rounded-full text-sm font-semibold text-fg transition-colors hover:bg-accent-2 hover:text-scrim focus-visible:bg-accent-2 focus-visible:text-scrim"
                >
                  <Icon aria-hidden="true" className="size-6" />
                  {t(`shell.new.${item.key}`)}
                </button>
              );
            })}

            <button
              type="button"
              onClick={close}
              aria-label={t("ui.close")}
              className="absolute end-1 top-1 grid size-11 place-items-center rounded-full bg-surface-2 text-fg-muted hover:text-fg"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
