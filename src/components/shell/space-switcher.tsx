"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Layers, Plus } from "lucide-react";
import { apiGet } from "@/lib/api-client";
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
  organizations: {
    id: string;
    name: string;
    keyPrefix: string;
    role: string;
    /** The `spaces.create` capability in this organization (the server decides, the menu follows). */
    canCreateSpaces: boolean;
    /** `holdsProjects`: false for «الشركة» (HQ), where no project is opened. */
    workspaces: { id: string; name: string; slug: string; holdsProjects?: boolean }[];
  }[];
}

/** The cache key the old shell used too: creating a space (create-forms.tsx) refreshes it. */
export const ORGS_QUERY_KEY = ["orgs"] as const;

/**
 * Where the switcher sits: `sidebar` the computer's side menu (a full-width button and «+» beside it),
 * `rail` the side menu folded to icons, `strip` the end of «الشغل»'s tab strip on a phone.
 */
export type SpaceSwitcherVariant = "sidebar" | "rail" | "strip";

/**
 * The spaces (workspaces) the person is in: «كل المساحات» and one entry per space (each opens its
 * projects, `/projects?workspace=…`), and «مساحة عمل جديدة» for whoever may open one (`spaces.create`,
 * never a guest). The new space is the existing WorkspaceCreateModal flow, unchanged.
 *
 * From the menu, the dialog opens only once the menu has closed and handed focus back to its button,
 * so the dialog remembers that button and gives focus back to it when it closes.
 *
 * `defaultOpen` and `portal={false}` are for server-render tests.
 */
export function SpaceSwitcher({
  variant,
  isGuest = false,
  defaultOpen,
  portal = true,
}: {
  variant: SpaceSwitcherVariant;
  isGuest?: boolean;
  defaultOpen?: boolean;
  portal?: boolean;
}) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const createAfterClose = useRef(false);
  const orgsQuery = useQuery({
    queryKey: ORGS_QUERY_KEY,
    queryFn: () => apiGet<OrgsResponse>("/api/workspaces"),
    retry: false,
  });

  const organizations = orgsQuery.data?.organizations ?? [];
  const spaces = organizations.flatMap((org) => org.workspaces);
  const canCreate = !isGuest && organizations.some((org) => org.canCreateSpaces);
  const label = t("shell.spaces.open");

  const trigger =
    variant === "sidebar" ? (
      <button
        type="button"
        className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm text-fg transition-colors hover:bg-surface-2"
      >
        <Layers aria-hidden="true" className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-start">{t("top.workspaces")}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted" />
      </button>
    ) : variant === "rail" ? (
      <button
        type="button"
        aria-label={label}
        title={label}
        className="grid size-11 place-items-center rounded-xl border border-border bg-surface text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <Layers aria-hidden="true" className="size-5" />
      </button>
    ) : (
      <button
        type="button"
        aria-label={label}
        title={label}
        className="flex h-11 shrink-0 items-center gap-0.5 rounded-lg px-2.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <Layers aria-hidden="true" className="size-5" />
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
          <DropdownMenuItem asChild>
            <Link href="/projects">
              <Layers aria-hidden="true" className="size-4 text-muted" />
              {t("shell.spaces.all")}
            </Link>
          </DropdownMenuItem>
          {spaces.map((space) => (
            <DropdownMenuItem key={space.id} asChild>
              <Link href={`/projects?workspace=${encodeURIComponent(space.id)}`}>
                <span aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate"><bdi>{space.name}</bdi></span>
              </Link>
            </DropdownMenuItem>
          ))}
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
