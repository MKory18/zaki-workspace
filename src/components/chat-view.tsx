"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MessageSquarePlus, Pencil, Pin, PinOff, Reply, Send, Trash2, X } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { avatarHue, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const POLL_LIST = 10_000;
const POLL_THREAD = 4_000;

interface ConvSummary {
  id: string;
  kind: "DM" | "GROUP";
  title: string;
  emoji: string | null;
  updatedAt: string;
  unread: number;
  lastMessage: { at: string; body: string | null; mine: boolean } | null;
  otherMembers: { id: string; name: string }[];
}

interface ThreadMessage {
  id: string;
  body: string | null;
  deleted: boolean;
  edited: boolean;
  pinned: boolean;
  mine: boolean;
  authorId: string;
  authorName: string;
  createdAt: string;
  replyToId: string | null;
  replyPreview: { id: string; body: string | null; authorName: string } | null;
  reactions: { emoji: string; count: number; mine: boolean }[];
}

interface ThreadDetail {
  id: string;
  kind: "DM" | "GROUP";
  title: string;
  emoji: string | null;
  members: { id: string; name: string; jobTitle: string | null; role: string }[];
  myRole: string;
  messages: ThreadMessage[];
}

interface DirectoryEntry {
  userId: string;
  role: string;
  user: { id: string; name: string; jobTitle: string | null };
}

const REACTIONS = ["ًں‘چ", "â‌¤ï¸ڈ", "ًںک‚", "ًںژ‰", "ًں”¥", "ًں‘€"];

export function ChatView({ ctx }: { ctx: { orgId: string; orgRole: string } }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ThreadMessage | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const composerRef = useRef<HTMLInputElement>(null);

  const canWrite = ctx.orgRole !== "GUEST";

  const convs = useQuery({
    queryKey: ["chat", "convs"],
    queryFn: () => apiGet<{ conversations: ConvSummary[] }>("/api/chat/conversations"),
    refetchInterval: POLL_LIST,
  });

  const thread = useQuery({
    queryKey: ["chat", "thread", selected],
    enabled: Boolean(selected),
    queryFn: () => apiGet<ThreadDetail>(`/api/chat/conversations/${selected}`),
    refetchInterval: POLL_THREAD,
  });

  // opening a conversation marks it read once
  useEffect(() => {
    if (!selected) return;
    apiPost(`/api/chat/conversations/${selected}`)
      .then(() => qc.invalidateQueries({ queryKey: ["chat", "convs"] }))
      .catch(() => undefined);
    setReplyTo(null);
    setEditing(null);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: () =>
      editing
        ? apiPatch(`/api/chat/messages/${editing.id}`, { body: composerRef.current!.value.trim() })
        : apiPost(`/api/chat/conversations/${selected}/messages`, {
            body: composerRef.current!.value.trim(),
            replyToId: replyTo?.id ?? undefined,
          }),
    onSuccess: () => {
      if (composerRef.current) composerRef.current.value = "";
      setReplyTo(null);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["chat", "thread", selected] });
      qc.invalidateQueries({ queryKey: ["chat", "convs"] });
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const pin = useMutation({
    mutationFn: (messageId: string) => apiPost(`/api/chat/messages/${messageId}/pin`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", "thread", selected] }),
    onError: (err) => toast(errText(err, t), "error"),
  });

  const del = useMutation({
    mutationFn: (messageId: string) => apiDelete(`/api/chat/messages/${messageId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", "thread", selected] }),
    onError: (err) => toast(errText(err, t), "error"),
  });

  const leave = useMutation({
    mutationFn: () => apiDelete(`/api/chat/conversations/${selected}`),
    onSuccess: () => {
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["chat", "convs"] });
      toast(t("chat.leftGroup"), "success");
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const list = convs.data?.conversations ?? [];
  const detail = thread.data;

  const pinnedMsgs = useMemo(
    () => (detail?.messages ?? []).filter((m) => m.pinned && !m.deleted),
    [detail],
  );

  if (thread.isError) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <p className="text-sm text-red-500">{t("common.error")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="grid h-[calc(100vh-10rem)] grid-cols-1 overflow-hidden rounded-xl border border-border md:grid-cols-[280px_1fr]">
        {/* conversations */}
        <aside className="flex flex-col border-l border-border max-md:border-b">
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="text-sm font-semibold">{t("chat.title")}</h2>
            {canWrite && (
              <Button size="sm" variant="ghost" onClick={() => setShowNew(true)} aria-label={t("chat.new")}>
                <MessageSquarePlus className="size-4" />
              </Button>
            )}
          </header>
          <ul className="flex-1 overflow-y-auto">
            {list.length === 0 && <li className="p-4 text-xs text-muted">{t("chat.noChats")}</li>}
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelected(c.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-right transition-colors hover:bg-surface-2",
                    selected === c.id && "bg-surface-2",
                  )}
                >
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-lg text-sm"
                    style={{ background: `hsla(${avatarHue(c.title)}, 60%, 50%, 0.15)` }}
                  >
                    {c.kind === "GROUP" ? c.emoji ?? "ًں’¬" : c.title.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-1">
                      <span className="truncate text-sm font-medium">{c.title}</span>
                      {c.unread > 0 && (
                        <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-fg">
                          {c.unread}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[10px] text-muted">
                      {c.lastMessage ? (c.lastMessage.body === null ? `â€” ${t("chat.deleted")}` : c.lastMessage.body || t("chat.emptySo")) : t("chat.emptySo")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* thread */}
        <section className="flex min-h-0 flex-col">
          {!detail ? (
            <div className="grid flex-1 place-items-center text-sm text-muted">{t("chat.pickConv")}</div>
          ) : (
            <>
              <header className="flex items-center justify-between border-b border-border px-4 py-2">
                <button type="button" onClick={() => detail.kind === "GROUP" && setShowMembers(true)} className="min-w-0 text-right">
                  <span className="block truncate text-sm font-semibold">
                    {detail.emoji ? `${detail.emoji} ` : ""}{detail.title}
                  </span>
                  <span className="text-[10px] text-muted">
                    {detail.kind === "GROUP"
                      ? t("chat.membersCount", { n: detail.members.length })
                      : t("chat.direct")}
                  </span>
                </button>
                {detail.kind === "GROUP" && (
                  <Button size="sm" variant="ghost" onClick={() => leave.mutate()} disabled={leave.isPending}>
                    {t("chat.leave")}
                  </Button>
                )}
              </header>

              {pinnedMsgs.length > 0 && (
                <div className="border-b border-border bg-amber-500/5 px-4 py-1.5">
                  {pinnedMsgs.map((m) => (
                    <div key={m.id} className="flex items-center gap-1.5 text-[11px] text-muted">
                      <Pin className="size-3 text-amber-500" />
                      <span className="font-medium">{m.authorName}:</span>
                      <span className="truncate">{m.body}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
                {detail.messages.length === 0 && (
                  <p className="mt-auto self-center text-xs text-muted">{t("chat.sayHi")}</p>
                )}
                {detail.messages.map((m) => (
                  <MessageRow
                    key={m.id}
                    m={m}
                    detail={detail}
                    onReply={() => {
                      setReplyTo(m);
                      setEditing(null);
                      composerRef.current?.focus();
                    }}
                    onEdit={() => {
                      setEditing({ id: m.id, body: m.body ?? "" });
                      setReplyTo(null);
                      if (composerRef.current) composerRef.current.value = m.body ?? "";
                      composerRef.current?.focus();
                    }}
                    onDelete={() => del.mutate(m.id)}
                    onPin={() => pin.mutate(m.id)}
                    disabled={!canWrite}
                  />
                ))}
              </div>

              {canWrite && (
                <footer className="border-t border-border p-3">
                  {(replyTo || editing) && (
                    <div className="mb-2 flex items-center justify-between rounded-lg bg-surface-2 px-2 py-1 text-[11px] text-muted">
                      <span className="truncate">
                        {editing ? t("chat.editing") : `${t("chat.replying")}: ${replyTo!.authorName} â€” ${replyTo!.body}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setReplyTo(null);
                          if (editing) {
                            setEditing(null);
                            if (composerRef.current) composerRef.current.value = "";
                          }
                        }}
                        aria-label={t("common.cancel")}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  )}
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const val = composerRef.current?.value.trim() ?? "";
                      if (!val) return;
                      send.mutate();
                    }}
                  >
                    <Input
                      ref={composerRef}
                      name="body"
                      maxLength={4000}
                      placeholder={t("chat.placeholder")}
                      className="flex-1"
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setReplyTo(null);
                          setEditing(null);
                          if (composerRef.current) composerRef.current.value = "";
                        }
                      }}
                    />
                    <Button type="submit" size="sm" disabled={send.isPending} aria-label={t("chat.send")}>
                      {editing ? <Check className="size-4" /> : <Send className="size-4" />}
                    </Button>
                  </form>
                </footer>
              )}
            </>
          )}
        </section>
      </div>

      {showNew && (
        <NewChatModal
          onClose={() => setShowNew(false)}
          onOpen={(id) => {
            setShowNew(false);
            setSelected(id);
          }}
        />
      )}
      {showMembers && detail && (
        <MembersModal
          detail={detail}
          onClose={() => setShowMembers(false)}
          onChanged={() => qc.invalidateQueries({ queryKey: ["chat", "thread", selected] })}
        />
      )}
    </div>
  );
}

function MessageRow({
  m,
  detail,
  onReply,
  onEdit,
  onDelete,
  onPin,
  disabled,
}: {
  m: ThreadMessage;
  detail: ThreadDetail;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const isGroupAdmin = detail.kind === "GROUP" && detail.myRole === "admin";
  const canEdit = m.mine || isGroupAdmin;
  const canPin = detail.kind === "DM" || isGroupAdmin;
  const [showActions, setShowActions] = useState(false);
  const [showPalette, setShowPalette] = useState(false);

  return (
    <div
      className={cn(
        "group relative max-w-[80%] rounded-2xl bg-surface-2 px-3 py-2 text-sm",
        m.mine ? "self-end bg-accent/10" : "self-start",
        m.deleted && "opacity-60",
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => {
        setShowActions(false);
        setShowPalette(false);
      }}
    >
      {!m.mine && <div className="mb-0.5 text-[10px] font-medium text-muted">{m.authorName}</div>}
      {m.replyPreview && (
        <div className="mb-1 rounded-lg border-r-2 border-accent bg-surface-1 px-2 py-1 text-[10px] text-muted">
          <div className="font-medium">{m.replyPreview.authorName}</div>
          <div className="truncate">{m.replyPreview.body}</div>
        </div>
      )}
      {m.deleted ? (
        <p className="text-xs italic text-muted">{t("chat.deleted")}</p>
      ) : (
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
      )}
      <div className="mt-0.5 flex items-center gap-2 text-[9px] text-muted">
        {m.pinned && <Pin className="size-2.5 text-amber-500" />}
        {m.edited && <span>{t("chat.edited")}</span>}
        <span>{fmtTime(m.createdAt)}</span>
      </div>

      {m.reactions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {m.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              disabled={disabled}
              onClick={() => reactTo(m.id, r.emoji)}
              className={cn(
                "rounded-full border border-border bg-surface-1 px-1.5 py-0.5 text-[10px] transition-colors",
                r.mine && "border-accent text-accent",
              )}
            >
              {r.emoji} {r.count}
            </button>
          ))}
        </div>
      )}

      {!disabled && !m.deleted && (
        <div
          className={cn(
            "absolute top-1 flex gap-0.5 rounded-full border border-border bg-surface-1 px-1 py-0.5 shadow-sm transition-opacity",
            showActions ? "opacity-100" : "opacity-0",
            m.mine ? "left-1" : "right-1",
          )}
        >
          <button type="button" className="p-0.5" aria-label={t("chat.react")} onClick={() => setShowPalette((s) => !s)}>
            <span className="text-[11px]">ًںکٹ</span>
          </button>
          <button type="button" className="p-0.5" aria-label={t("chat.reply")} onClick={onReply}>
            <Reply className="size-3" />
          </button>
          {canEdit && m.mine && (
            <button type="button" className="p-0.5" aria-label={t("chat.edit")} onClick={onEdit}>
              <Pencil className="size-3" />
            </button>
          )}
          {canPin && (
            <button type="button" className="p-0.5" aria-label={m.pinned ? t("chat.unpin") : t("chat.pin")} onClick={onPin}>
              {m.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
            </button>
          )}
          {canEdit && (
            <button type="button" className="p-0.5 text-red-500" aria-label={t("chat.delete")} onClick={onDelete}>
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      )}

      {showPalette && !disabled && (
        <div className="absolute bottom-full z-10 mb-1 flex gap-0.5 rounded-full border border-border bg-surface-1 px-2 py-1 shadow-sm ltr:left-2 rtl:right-2">
          {REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              className="text-sm transition-transform hover:scale-125"
              onClick={() => reactTo(m.id, e)}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  function reactTo(messageId: string, emoji: string) {
    fetch(`/api/chat/messages/${messageId}/react`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emoji }),
    }).then(async (res) => {
      if (!res.ok) toast(t("common.error"), "error");
    });
  }
}

function NewChatModal({ onClose, onOpen }: { onClose: () => void; onOpen: (conversationId: string) => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [mode, setMode] = useState<"DM" | "GROUP">("DM");
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("ًں’¬");
  const [picked, setPicked] = useState<string[]>([]);

  const dir = useQuery({ queryKey: ["chat", "directory"], queryFn: () => apiGet<{ people: DirectoryEntry[] }>("/api/chat/directory") });

  const create = useMutation({
    mutationFn: () =>
      mode === "DM"
        ? apiPost<{ id: string }>("/api/chat/conversations", { kind: "DM", userId: picked[0] })
        : apiPost<{ id: string }>("/api/chat/conversations", { kind: "GROUP", title, emoji, memberIds: picked }),
    onSuccess: (res) => onOpen(res.id),
    onError: (err) => toast(errText(err, t), "error"),
  });

  function pick(userId: string) {
    setPicked((prev) => (mode === "DM" ? [userId] : prev.includes(userId) ? prev.filter((x) => x !== userId) : [...prev, userId]));
  }

  const valid = mode === "DM" ? picked.length === 1 : title.trim().length >= 2 && picked.length >= 1;

  return (
    <Modal open onClose={onClose} title={t("chat.newTitle")}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button variant={mode === "DM" ? "primary" : "secondary"} size="sm" onClick={() => setMode("DM")}>
            {t("chat.kindDm")}
          </Button>
          <Button variant={mode === "GROUP" ? "primary" : "secondary"} size="sm" onClick={() => setMode("GROUP")}>
            {t("chat.kindGroup")}
          </Button>
        </div>

        {mode === "GROUP" && (
          <div className="flex gap-2">
            <select
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              className="w-14 rounded-lg border border-border bg-surface-1 px-1 text-center text-sm"
              aria-label={t("chat.groupEmoji")}
            >
              {["ًں’¬", "ًںژ¨", "ًں’»", "ًں–¥ï¸ڈ", "ًں’¼", "ًں“£", "âڑ™ï¸ڈ", "ًں‘”", "ًںڑ€"].map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("chat.groupTitle")} className="flex-1" maxLength={60} />
          </div>
        )}

        <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {(dir.data?.people ?? []).map((p) => (
            <li key={p.userId}>
              <button
                type="button"
                onClick={() => pick(p.userId)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-right transition-colors hover:bg-surface-2",
                  picked.includes(p.userId) && "bg-accent/10",
                )}
              >
                <span
                  className="grid size-8 place-items-center rounded-full text-xs font-semibold"
                  style={{ background: `hsla(${avatarHue(p.user.name)}, 60%, 50%, 0.2)` }}
                >
                  {p.user.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{p.user.name}</span>
                  <span className="block truncate text-[10px] text-muted">{p.user.jobTitle ?? ""}</span>
                </span>
              </button>
            </li>
          ))}
          {(dir.data?.people.length ?? 0) === 0 && <li className="p-3 text-xs text-muted">{t("chat.noPeople")}</li>}
        </ul>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={!valid || create.isPending} onClick={() => create.mutate()}>
            {t("chat.start")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MembersModal({
  detail,
  onClose,
  onChanged,
}: {
  detail: ThreadDetail;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const dir = useQuery({ queryKey: ["chat", "directory"], queryFn: () => apiGet<{ people: DirectoryEntry[] }>("/api/chat/directory") });
  const isAdmin = detail.myRole === "admin";

  const manage = useMutation({
    mutationFn: (input: { addUserIds?: string[]; removeUserIds?: string[] }) =>
      apiPatch(`/api/chat/conversations/${detail.id}`, input),
    onSuccess: () => {
      onChanged();
      toast(t("chat.updated"), "success");
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const addable = (dir.data?.people ?? []).filter((p) => !detail.members.some((m) => m.id === p.userId));

  return (
    <Modal open onClose={onClose} title={detail.title}>
      <div className="space-y-3">
        <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {detail.members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 px-3 py-2">
              <span
                className="grid size-8 place-items-center rounded-full text-xs font-semibold"
                style={{ background: `hsla(${avatarHue(m.name)}, 60%, 50%, 0.2)` }}
              >
                {m.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{m.name}</span>
                <span className="text-[10px] text-muted">{m.role === "admin" ? t("chat.adminRole") : ""}</span>
              </span>
              {isAdmin && (
                <button
                  type="button"
                  className="p-1 text-red-500 disabled:opacity-40"
                  disabled={detail.members.filter((x) => x.role === "admin").length <= 1 && m.role === "admin"}
                  onClick={() => manage.mutate({ removeUserIds: [m.id] })}
                  aria-label={t("chat.removeMember")}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <div className="flex flex-col gap-2">
            <ul className="max-h-32 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {addable.map((p) => (
                <li key={p.userId} className="flex items-center gap-1 px-2 py-1.5">
                  <button
                    type="button"
                    className="shrink-0 text-[11px] font-medium text-accent hover:underline"
                    onClick={() => manage.mutate({ addUserIds: [p.userId] })}
                  >
                    {t("chat.addMember")}
                  </button>
                  <span className="truncate text-[10px] text-muted">{p.user.name}</span>
                </li>
              ))}
              {addable.length === 0 && <li className="px-2 py-2 text-[10px] text-muted">{t("chat.everyoneIn")}</li>}
            </ul>
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function errText(err: unknown, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (err instanceof ApiError && err.code) {
    const translated = t(err.code);
    return translated !== err.code ? translated : t("common.error");
  }
  return t("common.error");
}
