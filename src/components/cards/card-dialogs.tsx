"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { apiGet, apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { CardItem } from "@/lib/cards/shared";
import { cardErrorKey } from "./errors";

/** «أرسل»: pick a topic of THIS space; the card's words go there as a message (never a file). */
export function SendCardDialog({ card, spaceId, onClose }: { card: CardItem | null; spaceId: string; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const topics = useQuery({
    queryKey: ["cards-topics", spaceId],
    queryFn: () => apiGet<{ topics: Array<{ id: string; title: string; emoji: string | null }> }>(`/api/cards/topics?spaceId=${encodeURIComponent(spaceId)}`),
    enabled: card !== null,
  });

  async function send(conversationId: string) {
    if (!card) return;
    setBusy(conversationId);
    try {
      await apiPost(`/api/cards/${card.id}/send`, { conversationId });
      toast(t("cards.sent"), "success");
      onClose();
    } catch (err) {
      toast(t(cardErrorKey(err)), "error");
      setBusy(null);
    }
  }

  return (
    <Modal open={card !== null} title={t("cards.send_title")} onClose={onClose}>
      <p className="mb-2 text-xs text-fg-muted">{t("cards.send_hint")}</p>
      {topics.isLoading ? <p className="text-sm text-fg-muted">{t("cards.loading")}</p> : null}
      {topics.data && topics.data.topics.length === 0 ? <p className="text-sm text-fg-muted">{t("cards.send_none")}</p> : null}
      <ul className="flex flex-col gap-1 p-0">
        {(topics.data?.topics ?? []).map((topic) => (
          <li key={topic.id} className="list-none">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void send(topic.id)}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 text-start text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              <span aria-hidden="true">{topic.emoji ?? "💬"}</span>
              <span dir="auto" className="min-w-0 truncate">{topic.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

interface ProjectRow {
  id: string;
  name: string;
}

/** «حوّلها لمهمة»: a project and a board of THIS space; the task service makes the task. */
export function CardToTaskDialog({ card, spaceId, onClose }: { card: CardItem | null; spaceId: string; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [projectId, setProjectId] = React.useState("");
  const [boardId, setBoardId] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const projects = useQuery({
    queryKey: ["cards-projects", spaceId],
    queryFn: () => apiGet<{ projects: ProjectRow[] }>(`/api/projects?workspaceId=${encodeURIComponent(spaceId)}`),
    enabled: card !== null,
  });
  const boards = useQuery({
    queryKey: ["cards-boards", projectId],
    queryFn: () => apiGet<{ boards: ProjectRow[] }>(`/api/projects/${projectId}/boards`),
    enabled: card !== null && projectId !== "",
  });

  async function submit() {
    if (!card || !projectId || !boardId) return;
    setBusy(true);
    try {
      await apiPost(`/api/cards/${card.id}/task`, { projectId, boardId });
      toast(t("cards.task_made"), "success");
      onClose();
    } catch (err) {
      toast(t(cardErrorKey(err)), "error");
      setBusy(false);
    }
  }

  const list = projects.data?.projects ?? [];
  return (
    <Modal open={card !== null} title={t("cards.to_task")} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {projects.data && list.length === 0 ? <p className="text-sm text-fg-muted">{t("cards.task_no_project")}</p> : null}
        <div>
          <Label>{t("cards.task_project")}</Label>
          <Select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setBoardId("");
            }}
          >
            <option value="">{t("cards.task_choose")}</option>
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("cards.task_board")}</Label>
          <Select value={boardId} onChange={(e) => setBoardId(e.target.value)} disabled={!projectId}>
            <option value="">{t("cards.task_choose")}</option>
            {(boards.data?.boards ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" disabled={busy || !projectId || !boardId} onClick={() => void submit()}>
          {t("cards.to_task")}
        </Button>
      </div>
    </Modal>
  );
}
