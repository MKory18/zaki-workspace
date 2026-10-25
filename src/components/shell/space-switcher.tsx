"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, LayoutGrid, Layers, Plus } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { goHref } from "@/lib/space-link";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { WorkspaceCreateModal } from "@/components/create-forms";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** GET /api/workspaces: the spaces the person may open, per organization, and whether they may open a new one there. */
export interface OrgsResponse {
  /** The space the person is in (src/server/services/current-space.ts). */
  currentSpaceId?: string | null;
  organizations: {
    id: string;
    name: string;
    keyPrefix: string;
    role: string;
    /** The `spaces.create` capability in this organization (the server decides, the menu follows). */
    canCreateSpaces: boolean;
    /** `holdsProjects`: false for «الشركة» (HQ), where no project is opened. */
    workspaces: { id: string; name: string; slug: string; holdsProjects?: boolean; emoji?: string | null; unread?: number }[];
  }[];
}

/** The space the person is in, as the server read it (src/server/services/current-space.ts). */
export interface ShellSpace {
  id: string;
  name: string;
  emoji: string | null;
}

/** The cache key the old shell used too: creating a space (create-forms.tsx) refreshes it. */
export const ORGS_QUERY_KEY = ["orgs"] as const;

/**
 * The spaces and the one the person is in, kept fresh: read again after every navigation (a page of another
 * space's task enters that space on the server, and the shell's layout is not drawn again on the way) and every
 * minute (the numbers beside the other spaces move while the person works).
 */
export function useSpaces() {
  const pathname = usePathname();
  const query = useQuery({
    queryKey: ORGS_QUERY_KEY,
    queryFn: () => apiGet<OrgsResponse>("/api/workspaces"),
    retry: false,
    refetchInterval: 60_000,
  });
  const { refetch } = query;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void refetch();
  }, [pathname, refetch]);
  return query;
}

/** The space the person is in: what the server said for this page, then what it says after each navigation. */
export function useCurrentSpace(initial: ShellSpace | null): ShellSpace | null {
  const { data } = useSpaces();
  const id = data?.currentSpaceId;
  if (!id) return initial;
  const found = data.organizations.flatMap((o) => o.workspaces).find((w) => w.id === id);
  return found ? { id: found.id, name: found.name, emoji: found.emoji ?? null } : initial;
}

/**
 * Where the switcher sits: `sidebar` the computer's side menu (a full-width button and «+» beside it),
 * `rail` the side menu folded to icons, `strip` the end of «الشغل»'s tab strip on a phone.
 */
export type SpaceSwitcherVariant = "sidebar" | "rail" | "strip";

/**
 * THE SPACE YOU ARE IN, and the way into another one — like switching accounts in a messaging app (the owner's
 * decision, 2026-10-25: a space is like a separate site). The button says the current space's name; the menu
 * lists every space of the person's with what is waiting there, and entering one (`/go`) opens its «اليوم».
 * «كل المساحات» (the overview of every space) is the owner's and the admins'; «مساحة عمل جديدة» is for whoever
 * may open one (`spaces.create`, never a guest). The new space is the existing WorkspaceCreateModal flow.
 *
 * From the menu, the dialog opens only once the menu has closed and handed focus back to its button,
 * so the dialog remembers that button and gives focus back to it when it closes.
 *
 * `defaultOpen` and `portal={false}` are for server-render tests.
 */
export function SpaceSwitcher({
  variant,
  isGuest = false,
  current = null,
  canOverview = false,
  defaultOpen,
  portal = true,
}: {
  variant: SpaceSwitcherVariant;
  isGuest?: boolean;
  /** The space the person is in (null: they are in none). */
  current?: ShellSpace | null;
  /** The owner and the admins: «كل المساحات». */
  canOverview?: boolean;
  defaultOpen?: boolean;
  portal?: boolean;
}) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const createAfterClose = useRef(false);
  const orgsQuery = useSpaces();

  const organizations = orgsQuery.data?.organizations ?? [];
  const spaces = organizations.flatMap((org) => org.workspaces);
  const canCreate = !isGuest && organizations.some((org) => org.canCreateSpaces);
  const label = current ? t("shell.spaces.current", { name: current.name }) : t("shell.spaces.open");
  // something waits in another space: a dot on the button (the numbers are in the menu)
  const waitingElsewhere = spaces.some((s) => s.id !== current?.id && (s.unread ?? 0) > 0);
  const dot = waitingElsewhere ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" /> : null;

  const trigger =
    variant === "sidebar" ? (
      <button
        type="button"
        className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm text-fg transition-colors hover:bg-surface-2"
      >
        <Layers aria-hidden="true" className="size-4 shrink-0 text-muted" />
        {/* the space's own name is written above it, in the menu's head (sidebar.tsx) */}
        <span className="min-w-0 flex-1 truncate text-start font-semibold">{t("shell.spaces.mine")}</span>
        {dot}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted" />
      </button>
    ) : variant === "rail" ? (
      <button
        type="button"
        aria-label={label}
        title={label}
        className="relative grid size-11 place-items-center rounded-xl border border-border bg-surface text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        {current?.emoji ? <span aria-hidden="true" className="text-lg leading-none">{current.emoji}</span> : <Layers aria-hidden="true" className="size-5" />}
        {dot ? <span className="absolute end-1 top-1">{dot}</span> : null}
      </button>
    ) : (
      <button
        type="button"
        aria-label={label}
        title={label}
        className="flex h-11 shrink-0 items-center gap-1 rounded-lg px-2.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        {current?.emoji ? <span aria-hidden="true" className="text-base leading-none">{current.emoji}</span> : <Layers aria-hidden="true" className="size-5" />}
        {dot}
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </button>
    );

  return (
    <>
      <DropdownMenu defaultOpen={defaultOpen}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent
          portal={portal}
          align={variant === "strip" ? "end" : "start"}
          className="w-72"
          onCloseAutoFocus={() => {
            if (!createAfterClose.current) return;
            createAfterClose.current = false;
            // after Radix has given focus back to the switcher (it does so right after this handler)
            window.setTimeout(() => setCreating(true), 0);
          }}
        >
          <DropdownMenuLabel>{t("top.workspaces")}</DropdownMenuLabel>
          {spaces.map((space) => {
            const here = space.id === current?.id;
            const waiting = here ? 0 : (space.unread ?? 0);
            return (
              <DropdownMenuItem key={space.id} asChild>
                <a
                  href={goHref(space.id)}
                  aria-current={here ? "true" : undefined}
                  aria-label={waiting > 0 ? t("shell.spaces.waiting", { name: space.name, n: fmtNumber(waiting) }) : undefined}
                  className={cn(here && "font-semibold text-fg")}
                >
                  <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center text-sm leading-none">
                    {space.emoji ?? ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate"><bdi>{space.name}</bdi></span>
                  {waiting > 0 ? (
                    <span aria-hidden="true" className="min-w-5 shrink-0 rounded-full bg-accent px-1.5 text-center text-xs font-bold leading-5 text-accent-fg">
                      {fmtNumber(waiting)}
                    </span>
                  ) : null}
                  {here ? <Check aria-hidden="true" className="size-4 shrink-0 text-accent" /> : null}
                </a>
              </DropdownMenuItem>
            );
          })}
          {canOverview && !isGuest && spaces.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/spaces">
                  <LayoutGrid aria-hidden="true" className="size-4 text-muted" />
                  {t("shell.spaces.all")}
                </Link>
              </DropdownMenuItem>
            </>
          ) : null}
          {spaces.length === 0 && !orgsQuery.isLoading ? (
            orgsQuery.isError ? (
              // the list failed to arrive: say so, and offer the way back — not a silent empty menu
              <div className="space-y-1 px-3 py-2">
                <p className="text-sm text-muted">{t("shell.spaces.error")}</p>
                <button
                  type="button"
                  onClick={() => orgsQuery.refetch()}
                  className="min-h-11 rounded-lg px-2 text-sm font-medium text-accent transition-colors hover:bg-surface-2"
                >
                  {t("shell.spaces.retry")}
                </button>
              </div>
            ) : (
              <p className="px-3 py-2 text-sm text-muted">{t("shell.spaces.empty")}</p>
            )
          ) : null}
          {canCreate ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  createAfterClose.current = true;
                }}
              >
                <Plus aria-hidden="true" className="size-4 text-muted" />
                {t("ws.new")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {canCreate && variant === "sidebar" ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          aria-label={t("ws.new")}
          title={t("ws.new")}
          className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-surface text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Plus aria-hidden="true" className="size-4" />
        </button>
      ) : null}

      {canCreate ? (
        <WorkspaceCreateModal
          open={creating}
          onClose={() => setCreating(false)}
          organizations={organizations.map((org) => ({ id: org.id, name: org.name, canAdmin: org.canCreateSpaces }))}
        />
      ) : null}
    </>
  );
}
