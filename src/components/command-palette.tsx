"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  FolderKanban,
  Inbox,
  ListFilter,
  CalendarDays,
  Search,
  SquareCheck,
  Factory,
  Target,
  Users,
} from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface SearchResponse {
  tasks: { id: string; key: string; title: string; priority: string; projectId: string; projectName: string }[];
  projects: { id: string; name: string; workspaceId: string; workspaceName: string }[];
}

interface Command {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
}

/** Global quick navigation. Ctrl/Cmd+K; searches authorized tasks/projects. */
export function CommandPalette() {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setCursor(0);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const staticCommands: Command[] = useMemo(
    () => [
      { id: "home", label: t("nav.home"), icon: LayoutDashboard, href: "/" },
      { id: "projects", label: t("nav.projects"), icon: FolderKanban, href: "/projects" },
      { id: "mywork", label: t("nav.myWork"), icon: Inbox, href: "/my-work" },
      { id: "list", label: t("nav.listView"), icon: ListFilter, href: "/list" },
      { id: "calendar", label: t("nav.calendar"), icon: CalendarDays, href: "/calendar" },
  { id: "production", label: t("nav.production"), icon: Factory, href: "/production" },
  { id: "goals", label: t("nav.goals"), icon: Target, href: "/goals" },
  { id: "members", label: t("nav.members"), icon: Users, href: "/members" },
    ],
    [t],
  );

  const search = useQuery({
    queryKey: ["palette", q],
    queryFn: () => apiGet<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: open && q.trim().length >= 2,
  });

  interface FlatResult {
    key: string;
    main: string;
    sub: string;
    href: string;
    type: "task" | "project";
  }

  const filteredCommands = q.trim()
    ? staticCommands.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()))
    : staticCommands;

  const results: FlatResult[] = [
    ...(search.data?.tasks ?? []).map((task) => ({
      key: `t:${task.id}`,
      main: `${task.key} ${task.title}`,
      sub: task.projectName,
      href: `/tasks/${task.id}`,
      type: "task" as const,
    })),
    ...(search.data?.projects ?? []).map((p) => ({
      key: `p:${p.id}`,
      main: p.name,
      sub: p.workspaceName,
      href: `/projects/${p.id}`,
      type: "project" as const,
    })),
  ];

  const total = filteredCommands.length + results.length;

  function go(matchIndex: number) {
    if (matchIndex < filteredCommands.length) {
      setOpen(false);
      setQ("");
      router.push(filteredCommands[matchIndex]!.href);
      return;
    }
    const hit = results[matchIndex - filteredCommands.length];
    if (!hit) return;
    setOpen(false);
    setQ("");
    router.push(hit.href);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label={t("pal.open")}
        className="flex w-60 items-center gap-2 rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-xs text-muted hover:border-ring"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-start">{t("pal.open")}</span>
        <kbd className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[9px] text-muted">Ctrl K</kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 px-4 pt-24" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("pal.open")}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-4 w-4 text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, total - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (total > 0) go(cursor);
              }
            }}
            placeholder={t("pal.placeholder")}
            className="flex-1 bg-transparent text-sm text-fg placeholder:text-muted focus:outline-none"
            aria-label={t("pal.placeholder")}
          />
          <kbd className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[9px] text-muted">Esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {filteredCommands.map((c, i) => (
            <PaletteRow
              key={c.id}
              active={cursor === i}
              onClick={() => go(i)}
              icon={<c.icon className="h-4 w-4" />}
              main={c.label}
            />
          ))}
          {results.map((r, i) => (
            <PaletteRow
              key={r.key}
              active={cursor === filteredCommands.length + i}
              onClick={() => go(filteredCommands.length + i)}
              icon={<SquareCheck className={cn("h-4 w-4", r.type === "project" && "text-muted")} />}
              main={r.main}
              sub={r.sub}
            />
          ))}
          {total === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted">
              {search.isLoading ? t("common.loading") : q.trim().length >= 2 ? t("common.noResults") : t("pal.hint")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PaletteRow({
  active,
  onClick,
  icon,
  main,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  main: string;
  sub?: string;
}) {
  return (
    <button
      onClick={onClick}
      role="option"
      aria-selected={active}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm",
        active ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2",
      )}
    >
      <span className="text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{main}</span>
      {sub ? <span className="max-w-32 truncate text-[10px] text-muted">{sub}</span> : null}
    </button>
  );
}
