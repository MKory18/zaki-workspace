"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/format";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
}

export function NotificationBell() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet<NotificationsResponse>("/api/notifications"),
    refetchInterval: 30_000,
  });

  const markAll = useMutation({
    mutationFn: () => apiPost("/api/notifications/read", { all: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => apiPost("/api/notifications/read", { ids: [id] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/notifications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = query.data?.unreadCount ?? 0;

  return (
    <div className="relative">
      <button
        aria-label={t("notif.title")}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute end-0 top-9 z-40 w-80 rounded-xl border border-border bg-surface shadow-lg animate-fade-in">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-xs font-semibold text-fg">{t("notif.title")}</p>
            {unread > 0 ? (
              <button
                onClick={() => markAll.mutate()}
                className="text-[11px] text-accent hover:underline"
              >
                {t("notif.markAll")}
              </button>
            ) : null}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {(query.data?.items ?? []).length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-muted">{t("notif.empty")}</li>
            ) : (
              query.data!.items.map((n) => (
                <li key={n.id} className={cn("border-b border-border last:border-0", !n.readAt && "bg-surface-2/40")}>
                  <div className="group flex items-start">
                    <div className="min-w-0 flex-1">
                      {n.linkUrl ? (
                        <Link
                          href={n.linkUrl}
                          onClick={() => {
                            setOpen(false);
                            if (!n.readAt) markOne.mutate(n.id);
                          }}
                          className="block px-3 py-2.5 pe-1 hover:bg-surface-2/60"
                        >
                          <NotificationRow n={n} />
                        </Link>
                      ) : (
                        <div className="px-3 py-2.5 pe-1">
                          <NotificationRow n={n} />
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {!n.readAt ? (
                        <button
                          aria-label={t("notif.markRead")}
                          onClick={() => markOne.mutate(n.id)}
                          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
                        >
                          <Check className="size-3.5" />
                        </button>
                      ) : null}
                      <button
                        aria-label={t("notif.delete")}
                        onClick={() => del.mutate(n.id)}
                        className="rounded p-1 text-muted hover:bg-surface-2 hover:text-red-500"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function NotificationRow({ n }: { n: NotificationItem }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-fg">{n.title}</p>
        <p className="shrink-0 text-[10px] text-muted">{formatDate(n.createdAt, "en")}</p>
      </div>
      {n.body ? <p className="mt-0.5 line-clamp-2 text-[11px] text-fg-muted">{n.body}</p> : null}
    </>
  );
}
