"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, ApiError } from "@/lib/api-client";
import { useI18n as useT } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";

function useCreate<T>({ path, onDone }: { path: string; onDone?: (data: T) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useT();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPost<{ [k: string]: unknown }>(path, body),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["orgs"] });
      toast(t("common.created"), "success");
      router.refresh();
      onDone?.(data as T);
    },
    onError: (err) => {
      const msg = err instanceof ApiError && err.code === "forbidden" ? t("forbidden") : t("common.error");
      setError(msg);
      toast(msg, "error");
    },
  });
  return { mutation, error };
}

export function WorkspaceCreateModal({
  open,
  onClose,
  organizations,
}: {
  open: boolean;
  onClose: () => void;
  organizations: { id: string; name: string; canAdmin: boolean }[];
}) {
  const { t } = useT();
  const adminOrgs = organizations.filter((o) => o.canAdmin);
  const { mutation, error } = useCreate<{ workspace: { id: string } }>({
    path: "/api/workspaces",
    onDone: () => onClose(),
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    mutation.mutate({
      organizationId: String(fd.get("organizationId")),
      name: String(fd.get("name")),
      description: String(fd.get("description") || "") || undefined,
    });
  }

  return (
    <Modal open={open} title={t("ws.new")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>{t("settings.org")}</Label>
          <select
            name="organizationId"
            required
            className="h-9 w-full rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg"
          >
            {adminOrgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>{t("ws.name")}</Label>
          <Input name="name" required maxLength={120} />
        </div>
        <div>
          <Label>{t("ws.desc")}</Label>
          <Textarea name="description" rows={2} maxLength={2000} />
        </div>
        {error ? <p className="text-xs text-danger">{t(error)}</p> : null}
        <Button type="submit" disabled={mutation.isPending} className="w-full">
          {t("ws.create")}
        </Button>
      </form>
    </Modal>
  );
}

export function ProjectCreateModal({
  open,
  onClose,
  workspaces,
}: {
  open: boolean;
  onClose: () => void;
  workspaces: { id: string; name: string }[];
}) {
  const { t } = useT();
  const { mutation, error } = useCreate<{ project: { id: string } }>({
    path: "/api/projects",
    onDone: (data) => {
      onClose();
      const id = (data as { project?: { id?: string } }).project?.id;
      if (id) window.location.href = `/projects/${id}`;
    },
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const start = String(fd.get("startDate") || "");
    const target = String(fd.get("targetDate") || "");
    mutation.mutate({
      workspaceId: String(fd.get("workspaceId")),
      name: String(fd.get("name")),
      description: String(fd.get("description") || "") || undefined,
      startDate: start || undefined,
      targetDate: target || undefined,
    });
  }

  return (
    <Modal open={open} title={t("proj.new")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>{t("ws.one")}</Label>
          <select
            name="workspaceId"
            required
            className="h-9 w-full rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>{t("proj.name")}</Label>
          <Input name="name" required maxLength={120} />
        </div>
        <div>
          <Label>{t("proj.desc")}</Label>
          <Textarea name="description" rows={2} maxLength={2000} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>{t("proj.start")}</Label>
            <Input type="date" name="startDate" />
          </div>
          <div>
            <Label>{t("proj.target")}</Label>
            <Input type="date" name="targetDate" />
          </div>
        </div>
        {error ? <p className="text-xs text-danger">{t(error)}</p> : null}
        <Button type="submit" disabled={mutation.isPending} className="w-full">
          {t("proj.create")}
        </Button>
      </form>
    </Modal>
  );
}

export function BoardCreateModal({
  open,
  onClose,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
}) {
  const { t } = useT();
  const { mutation, error } = useCreate<{ board: { id: string } }>({
    path: "/api/boards",
    onDone: (data) => {
      onClose();
      const id = (data as { board?: { id?: string } }).board?.id;
      if (id) window.location.href = `/boards/${id}`;
    },
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    mutation.mutate({
      projectId,
      name: String(fd.get("name")),
      description: String(fd.get("description") || "") || undefined,
    });
  }

  return (
    <Modal open={open} title={t("board.new")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>{t("board.name")}</Label>
          <Input name="name" required maxLength={120} />
        </div>
        <div>
          <Label>{t("proj.desc")}</Label>
          <Textarea name="description" rows={2} maxLength={2000} />
        </div>
        {error ? <p className="text-xs text-danger">{t(error)}</p> : null}
        <Button type="submit" disabled={mutation.isPending} className="w-full">
          {t("board.create")}
        </Button>
      </form>
    </Modal>
  );
}
