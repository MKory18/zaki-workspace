"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Plug, RefreshCw, Send, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface TgChatItem {
  id: string;
  chatId: string;
  title: string;
  type: string;
  createdAt: string;
}

export interface TgMessageItem {
  id: string;
  messageId: number;
  fromName: string;
  fromId: string | null;
  text: string | null;
  isCommand: boolean;
  sentAt: string;
}

interface TelegramStatus {
  chats: { chats: TgChatItem[]; lastSyncAt: string | null } | null;
  botUsername: string | null;
}

const TOKEN_SHAPE = /^\d+:[A-Za-z0-9_-]{30,}$/;

export function TelegramView({
  ctx,
  initial,
}: {
  ctx: { orgRole: string };
  initial: { chats: { chats: TgChatItem[]; lastSyncAt: string | null } | null; botUsername: string | null };
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const canManage = ctx.orgRole === "OWNER" || ctx.orgRole === "ADMIN";
  const canSend = ctx.orgRole !== "GUEST";

  const status = useQuery({
    queryKey: ["telegram", "status"],
    queryFn: () => apiGet<TelegramStatus>("/api/integrations/telegram"),
    initialData: initial,
  });

  const [token, setToken] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const connect = useMutation({
    mutationFn: () => apiPost<{ ok: true; botUsername: string }>("/api/integrations/telegram", { token: token.trim() }),
    onSuccess: (res) => {
      toast(t("telegram.connected", { bot: res.botUsername }), "success");
      setToken("");
      qc.invalidateQueries({ queryKey: ["telegram"] });
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const disconnect = useMutation({
    mutationFn: () => apiDelete("/api/integrations/telegram"),
    onSuccess: () => {
      toast(t("telegram.disconnected"), "success");
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["telegram"] });
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const sync = useMutation({
    mutationFn: () => apiPost<{ ok: true; stored: number }>("/api/integrations/telegram/sync"),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["telegram"] });
      qc.invalidateQueries({ queryKey: ["telegram-messages"] });
      toast(t("telegram.syncDone", { count: res.stored }), res.stored > 0 ? "success" : "info");
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const send = useMutation({
    mutationFn: (text: string) => apiPost("/api/integrations/telegram/send", { chatId: selected, text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["telegram-messages"] });
      qc.invalidateQueries({ queryKey: ["telegram"] });
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const chats = status.data?.chats?.chats ?? [];
  const connected = Boolean(status.data?.botUsername) || chats.length > 0;

  const activeChat = chats.find((c) => c.chatId === selected) ?? null;

  const messages = useQuery({
    queryKey: ["telegram-messages", selected],
    enabled: Boolean(selected),
    queryFn: () =>
      apiGet<{ messages: TgMessageItem[] }>(
        `/api/integrations/telegram/messages?chatId=${encodeURIComponent(selected!)}`,
      ),
  });

  if (status.isLoading) {
    return <div className="p-6 text-sm text-muted">{t("common.loading")}</div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-info/10 text-info">
            <Bot className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{t("telegram.title")}</h1>
            <p className="text-xs text-muted">{t("telegram.subtitle")}</p>
          </div>
        </div>
        {connected && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">
              {status.data?.botUsername ? `@${status.data.botUsername}` : t("telegram.connectedBadge")}
            </span>
            {canManage && (
              <>
                <Button variant="secondary" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
                  <RefreshCw className={cn("size-4", sync.isPending && "animate-spin")} />
                  {t("telegram.sync")}
                </Button>
                <Button variant="danger" size="sm" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                  <Trash2 className="size-4" />
                  {t("telegram.disconnect")}
                </Button>
              </>
            )}
          </div>
        )}
      </header>

      {!connected ? (
        <section className="space-y-4 rounded-xl border border-border bg-surface-1 p-5">
          <h2 className="text-sm font-semibold">{t("telegram.connectTitle")}</h2>
          <ol className="list-inside list-decimal space-y-1 text-xs text-muted">
            <li>{t("telegram.guide1")}</li>
            <li>{t("telegram.guide2")}</li>
            <li>{t("telegram.guide3")}</li>
          </ol>
          {canManage ? (
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (!TOKEN_SHAPE.test(token.trim())) {
                  toast(t("telegram.token_shape"), "error");
                  return;
                }
                connect.mutate();
              }}
            >
              <Input
                dir="ltr"
                placeholder="123456789:AA…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="flex-1 font-mono text-sm"
                aria-label={t("telegram.tokenLabel")}
              />
              <Button type="submit" disabled={connect.isPending || !token.trim()}>
                <Plug className="size-4" />
                {t("telegram.connect")}
              </Button>
            </form>
          ) : ctx.orgRole === "GUEST" ? (
            <p className="text-xs text-muted">{t("telegram.guestNote")}</p>
          ) : (
            <p className="text-xs text-muted">{t("telegram.managerOnly")}</p>
          )}
        </section>
      ) : (
        <section className="grid gap-0 overflow-hidden rounded-xl border border-border md:grid-cols-[260px_1fr]">
          <div className="max-h-[24rem] overflow-y-auto border-b border-border md:max-h-[34rem] md:border-b-0 md:border-l">
                {chats.length === 0 ? (
                  <div className="p-4 text-xs leading-6 text-muted">
                    <p>{t("telegram.noChats")}</p>
                    <p className="mt-2">{t("telegram.noChatsHint")}</p>
                    {canManage && (
                      <Button variant="secondary" size="sm" className="mt-3" onClick={() => sync.mutate()} disabled={sync.isPending}>
                        {t("telegram.sync")}
                      </Button>
                    )}
                    {ctx.orgRole === "GUEST" && <p className="mt-2">{t("telegram.guestNote")}</p>}
                  </div>
                ) : (
              <ul className="divide-y divide-border">
                {chats.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(c.chatId)}
                      className={cn(
                        "flex w-full flex-col gap-0.5 px-3 py-2 text-right transition-colors hover:bg-surface-2",
                        selected === c.chatId && "bg-surface-2",
                      )}
                    >
                      <span className="line-clamp-1 text-sm font-medium">{c.title}</span>
                      <span className="text-xs text-muted">{enumLabel("TelegramChatType", c.type)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex min-h-[24rem] flex-col md:min-h-[34rem]">
            {!activeChat ? (
              <div className="grid flex-1 place-items-center p-6 text-sm text-muted">{t("telegram.pickChat")}</div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                  <span className="text-sm font-medium">{activeChat.title}</span>
                  <span className="text-xs text-muted">{enumLabel("TelegramChatType", activeChat.type)}</span>
                </div>
                <div className="flex flex-1 flex-col-reverse gap-2 overflow-y-auto p-4">
                  {messages.isLoading && <span className="text-xs text-muted">{t("common.loading")}</span>}
                  <div className="flex flex-col gap-2">
                    {(messages.data?.messages ?? []).map((m) => (
                      <div
                        key={m.id}
                        className={cn(
                          "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                          m.fromId === null ? "mr-auto bg-info/10" : "ml-auto bg-surface-2",
                        )}
                      >
                        <div className="mb-0.5 flex items-baseline gap-2">
                          <span className={cn("text-xs font-medium", m.isCommand && "text-info")}>{m.fromName}</span>
                          <span className="text-xs text-muted">{fmtDateTime(m.sentAt)}</span>
                        </div>
                        <p className="whitespace-pre-wrap break-words">{m.text ?? "…"}</p>
                      </div>
                    ))}
                    {!messages.isLoading && (messages.data?.messages.length ?? 0) === 0 && (
                      <p className="text-xs text-muted">{t("telegram.emptyThread")}</p>
                    )}
                  </div>
                </div>
                {canSend && (
                  <form
                    className="flex items-center gap-2 border-t border-border p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const inputEl = form.elements.namedItem("body") as HTMLInputElement | null;
                      const text = (inputEl?.value ?? "").trim();
                      if (!text) return;
                      send.mutate(text, {
                        onSuccess: () => {
                          if (inputEl) inputEl.value = "";
                        },
                      });
                    }}
                  >
                    <Input name="body" className="flex-1" placeholder={t("telegram.sendPlaceholder")} />
                    <Button type="submit" size="sm" disabled={send.isPending}>
                      <Send className="size-4" />
                      {t("telegram.send")}
                    </Button>
                  </form>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function errText(err: unknown, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (err instanceof ApiError && err.code) {
    const key = err.code; // server sends i18n-ready error codes
    const translated = t(key);
    return translated !== key ? translated : t("common.error");
  }
  return t("common.error");
}
