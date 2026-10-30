"use client";

import type { ReactNode } from "react";
import { ZakiMark } from "@/components/logo";
import { ArtSlot } from "@/components/theme/art-slot";
import { ThemeDecor } from "@/components/theme/theme-decor";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * THE DOOR: the calm screen before the work — sign-in, the first-run set-up, the onboarding.
 *
 * Mobile first (375 px, 16 px gutters): the Zaki Workspace mark and wordmark, then the card. Behind it the
 * decoration layer of the active theme (`ThemeDecor kind="door"`: Islamic ornament, the neon-coast photograph, or
 * a faint wash), and over that the owner's `login-door` picture once the file exists (Islamic themes only, see
 * `ART_SCENES`). These are the only moments of the product where nothing is being measured or decided, which is
 * why this is where the brand goes; inside, the numbers do.
 *
 * ⚠️ Text over a picture is always on a scrim. The text column carries `zk-door-column`, a marker that styles
 * nothing by itself: under «ساحل النيون», and whenever the login picture has loaded, `decor.css` turns it into a
 * panel of the page's own colour, and THAT is what every word outside the card is read against (the card is
 * opaque and is read against its own surface). So the words out here are `fg`, `fg-muted` and `accent` only —
 * the three colours `tests/themes-decor-readable.test.ts` holds over the worst picture there could be.
 *
 * The column is positioned (`relative z-10`): a positioned layer paints over a static one whatever the order of
 * the markup, so without it the ornament would be drawn on top of the wordmark and the card.
 */
export function DoorShell({ children, width = "sm" }: { children?: ReactNode; width?: "sm" | "md" }) {
  const { t } = useI18n();
  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-surface px-4 py-8">
      <ThemeDecor kind="door" />
      <ArtSlot slot="login-door" className="zk-door-art" />
      <div className={cn("zk-door-column relative z-10 w-full space-y-5 p-2 sm:p-3", width === "md" ? "max-w-md" : "max-w-sm")}>
        <div className="flex flex-col items-center gap-2 text-center">
          {/* The mark says nothing the wordmark does not: hidden from assistive technology, so the name is read once. */}
          <span aria-hidden="true">
            <ZakiMark className="size-14" />
          </span>
          <p lang="en" dir="ltr" className="text-2xl font-bold tracking-tight text-fg">
            {t("app.name")}
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}
