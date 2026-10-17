"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  LayoutDashboard,
  FolderKanban,
  Inbox as InboxIcon,
  Lightbulb,
  FileText,
  Send,
  Workflow,
  BarChart3,
  Settings,
  PanelsTopLeft,
  ChevronLeft,
  LogOut,
  Sun,
  Moon,
  Monitor,
  Users,
  UserRoundPlus,
  ListFilter,
  CalendarDays,
  MessageSquare,
  FolderOpen,
  Network,
  Factory,
  Target,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Logo, DolphinMark } from "@/components/logo";import { NotificationBell } from "@/components/notification-bell";
import { WorkspaceCreateModal } from "@/components/create-forms";
import { CommandPalette } from "@/components/command-palette";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { apiGet, apiPost } from "@/lib/api-client";
import type { CurrentUser } from "@/server/auth";

interface NavSection {
  titleKey: string;
  items: { href?: string; labelKey: string; icon: React.ComponentType<{ className?: string }>; tint?: string }[];
}

const SECTIONS: NavSection[] = [
  {
    titleKey: "nav.home",
    items: [
      { href: "/", labelKey: "nav.home", icon: LayoutDashboard, tint: "text-blue-500" },
      { href: "/projects", labelKey: "nav.projects", icon: FolderKanban, tint: "text-violet-500" },
      { href: "/my-work", labelKey: "nav.myWork", icon: InboxIcon, tint: "text-emerald-500" },
      { href: "/list", labelKey: "nav.listView", icon: ListFilter, tint: "text-sky-500" },
      { href: "/calendar", labelKey: "nav.calendar", icon: CalendarDays, tint: "text-orange-500" },
      { href: "/chat", labelKey: "nav.chat", icon: MessageSquare, tint: "text-rose-500" },
      { href: "/production", labelKey: "nav.production", icon: Factory, tint: "text-orange-600" },
    ],
  },
  {
    titleKey: "nav.ideas",
    items: [
      { href: "/ideas", labelKey: "nav.ideas", icon: Lightbulb, tint: "text-amber-500" },
      { href: "/goals", labelKey: "nav.goals", icon: Target, tint: "text-red-500" },
      { href: "/documents", labelKey: "nav.docs", icon: FileText, tint: "text-indigo-500" },
      { href: "/files", labelKey: "nav.files", icon: FolderOpen, tint: "text-teal-500" },
      { href: "/departments", labelKey: "nav.departments", icon: Network, tint: "text-fuchsia-500" },
      { href: "/members", labelKey: "nav.members", icon: Users, tint: "text-cyan-600" },
      { href: "/teams", labelKey: "nav.teams", icon: UserRoundPlus, tint: "text-lime-600" },
    ],
  },
  {
    titleKey: "top.workspaces",
    items: [
      { href: "/telegram", labelKey: "nav.telegram", icon: Send, tint: "text-sky-500" },
      { href: "/automation", labelKey: "nav.automation", icon: Workflow, tint: "text-purple-500" },
      { href: "/analytics", labelKey: "nav.analytics", icon: BarChart3, tint: "text-green-500" },
      { href: "/settings", labelKey: "nav.settings", icon: Settings, tint: "text-slate-500" },
    ],
  },
];

interface OrgsResponse {
  organizations: {
    id: string;
    name: string;
    keyPrefix: string;
    role: string;
    workspaces: { id: string; name: string; slug: string }[];
  }[];
}

export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [wsModal, setWsModal] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const orgsQuery = useQuery({
    queryKey: ["orgs"],
    queryFn: () => apiGet<OrgsResponse>("/api/workspaces"),
    retry: false,
  });

  const logout = useMutation({
    mutationFn: () => apiPost("/api/auth/logout"),
    onSuccess: () => {
      window.location.href = "/login";
    },
  });

  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-s border-border bg-surface-1 transition-all duration-150",
          collapsed ? "w-14" : "w-60",
        )}
      >
        <div className="flex items-center justify-between px-3 py-3">
          {!collapsed ? <Logo /> : <DolphinMark className="mx-auto size-7" />}
          <button
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden rounded-lg p-1 text-muted hover:bg-surface-2 md:block"
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </button>
        </div>

        {!collapsed ? (
          <div className="px-3 pb-2">
            <select
              aria-label={t("top.workspaces")}
              className="h-8 w-full rounded-lg border border-border bg-surface-1 px-2 text-xs text-fg"
              defaultValue=""
              onChange={(e) => {
                const wsId = e.target.value;
                if (wsId === "new") setWsModal(true);
                else if (wsId) router.push(`/projects?workspace=${wsId}`);
              }}
            >
              <option value="" disabled>
                {t("top.workspaces")}
              </option>
              {orgsQuery.data?.organizations.flatMap((org) => org.workspaces).map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
              <option value="new">＋ {t("ws.new")}</option>
            </select>
            <WorkspaceCreateModal
              open={wsModal}
              onClose={() => setWsModal(false)}
              organizations={(orgsQuery.data?.organizations ?? []).map((o) => ({
                id: o.id,
                name: o.name,
                canAdmin: o.role === "OWNER" || o.role === "ADMIN",
              }))}
            />
          </div>
        ) : null}

        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-2">
          {SECTIONS.map((section) => (
            <div key={section.titleKey}>
              {!collapsed ? (
            <p className="px-2.5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-muted">
              {t(section.titleKey)}
            </p>
          ) : null}
          <ul className="space-y-px">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      active
                        ? "bg-surface-2 font-medium text-fg"
                        : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                    )}
                    title={t(item.labelKey)}
                  >
                    <item.icon className={cn("h-4 w-4 shrink-0", item.tint ?? "text-muted")} />
                        {!collapsed ? t(item.labelKey) : null}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-2">
          <div className={cn("flex items-center gap-2 px-1", collapsed && "justify-center")}>
            <a
              href="/profile"
              title={t("profile.title")}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-fg-muted hover:bg-surface-2/80"
            >
              {user.name.slice(0, 2).toUpperCase()}
            </a>
            {!collapsed ? (
              <a href="/profile" className="min-w-0 flex-1 hover:opacity-90">
                <p className="truncate text-xs font-medium text-fg">{user.name}</p>
                <p className="truncate text-[10px] text-muted">{user.email}</p>
              </a>
            ) : null}
            <button
              onClick={() => logout.mutate()}
              aria-label={t("common.logout")}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="flex h-12 items-center gap-3 border-b border-border bg-surface px-4">
          <PanelsTopLeft className="h-4 w-4 text-muted md:hidden" />
          <div className="flex flex-1 justify-center md:justify-start md:pe-6">
            <CommandPalette />
          </div>
          <NotificationBell />
          <button
            aria-label={t("top.theme")}
            onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
          >
            {theme === "dark" ? (
              <Moon className="h-4 w-4" />
            ) : theme === "light" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Monitor className="h-4 w-4" />
            )}
          </button>
        </header>

        <div className="flex min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
