"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { CircleDot, ExternalLink, FileText, Globe, Plug, Webhook } from "lucide-react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** Must mirror N8N_EVENTS in src/server/services/n8n.ts. */
const N8N_EVENTS = [
  "task.created",
  "task.completed",
  "task.moved",
  "idea.created",
  "idea.accepted",
  "idea.rejected",
  "comment.created",
  "member.joined",
] as const;

interface N8nStatus {
  status: {
    connected: boolean;
    webhookUrl: string | null;
    events: string[];
    sharedSecret: string | null;
  };
  events: Array<{ id: string; direction: string; type: string; status: string; detail: string | null; createdAt: string }>;
}

interface GoogleStatus {
  connected: boolean;
  configured: boolean;
  files?: DriveFile[];
  filesError?: string | null;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  link: string | null;
}

export function AutomationView({ ctx }: { ctx: { orgRole: string } }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const params = useSearchParams();
  const canManage = ctx.orgRole === "OWNER" || ctx.orgRole === "ADMIN";

  // Google OAuth redirects back with ?google=… — surface exactly one verdict.
  const googleResult = params.get("google");
  useEffect(() => {
    if (!googleResult) return;
    const verdict: Record<string, string> = {
      connected: t("google.connectedToast"),
      not_configured: t("google.notConfigured"),
    };
    toast(verdict[googleResult] ?? t("google.errorToast"), googleResult === "connected" ? "success" : "error");
  }, [googleResult]); // eslint-disable-line react-hooks/exhaustive-deps

  const n8n = useQuery({ queryKey: ["n8n"], queryFn: () => apiGet<N8nStatus>("/api/integrations/n8n") });

  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated || !n8n.data) return;
    if (n8n.data.status.webhookUrl) setWebhookUrl(n8n.data.status.webhookUrl);
    setSelectedEvents(n8n.data.status.events ?? []);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n8n.data]);

  const saveN8n = useMutation({
    mutationFn: (rotate: boolean) =>
      apiPost<{ generatedSecret?: string; connected: boolean }>("/api/integrations/n8n", {
        webhookUrl: webhookUrl.trim(),
        events: selectedEvents,
        rotateSecret: rotate,
      }),
    onSuccess: (res) => {
      if (res.generatedSecret) setGeneratedSecret(res.generatedSecret);
      toast(t("n8n.saved"), "success");
      qc.invalidateQueries({ queryKey: ["n8n"] });
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const testN8n = useMutation({
    mutationFn: () => apiPost<{ delivered: boolean; detail?: string }>("/api/integrations/n8n/test"),
    onSuccess: (res) => {
      toast(res.delivered ? t("n8n.testOk") : `${t("n8n.testFail")}${res.detail ? ` — ${res.detail}` : ""}`, res.delivered ? "success" : "error");
      qc.invalidateQueries({ queryKey: ["n8n"] });
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const deleteN8n = useMutation({
    mutationFn: () => apiDelete("/api/integrations/n8n"),
    onSuccess: () => {
      setGeneratedSecret(null);
      qc.invalidateQueries({ queryKey: ["n8n"] });
      toast(t("n8n.removed"), "success");
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const [showFiles, setShowFiles] = useState(false);
  // The Drive file list is for org managers only (the server answers 403 otherwise) and is only
  // fetched when it is actually being shown (`?files=1`); the status itself is open to every member.
  const wantFiles = showFiles && canManage;
  const google = useQuery({
    queryKey: ["google", wantFiles],
    queryFn: () => apiGet<GoogleStatus>(`/api/integrations/google${wantFiles ? "?files=1" : ""}`),
  });

  const disconnectGoogle = useMutation({
    mutationFn: () => apiDelete("/api/integrations/google"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["google"] });
      toast(t("google.disconnected"), "success");
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">{t("automation.title")}</h1>
        <p className="text-xs text-muted">{t("automation.subtitle")}</p>
      </header>

      {/* ---------------- n8n ---------------- */}
      <section className="space-y-4 rounded-xl border border-border bg-surface-1 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-lg bg-fuchsia-500/15 text-fuchsia-500">
              <Webhook className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">n8n</h2>
              <p className="text-xs text-muted">{t("n8n.subtitle")}</p>
            </div>
          </div>
          {n8n.data && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                n8n.data.status.connected ? "bg-emerald-500/15 text-emerald-600" : "bg-surface-2 text-muted",
              )}
            >
              {n8n.data.status.connected ? t("n8n.connected") : t("n8n.notConnected")}
            </span>
          )}
        </div>

        {canManage ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                dir="ltr"
                placeholder="https://n8n.example.com/webhook/zaki"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                className="flex-1 font-mono text-sm"
                aria-label="n8n webhook URL"
              />
              <Button onClick={() => saveN8n.mutate(false)} disabled={saveN8n.isPending || !webhookUrl.trim()}>
                {t("n8n.save")}
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              {N8N_EVENTS.map((e) => {
                const on = selectedEvents.includes(e);
                return (
                  <button
                    key={e}
                    type="button"
                    onClick={() =>
                      setSelectedEvents((prev) => (on ? prev.filter((x) => x !== e) : [...prev, e]))
                    }
                    className={cn(
                      "rounded-lg border px-2 py-1 font-mono text-[10px] transition-colors",
                      on ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:bg-surface-2",
                    )}
                  >
                    {e}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => testN8n.mutate()} disabled={!n8n.data?.status.connected || testN8n.isPending}>
                <CircleDot className="size-4" />
                {t("n8n.test")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => saveN8n.mutate(true)} disabled={!n8n.data || saveN8n.isPending}>
                {t("n8n.rotate")}
              </Button>
              {n8n.data?.status.connected && (
                <Button variant="danger" size="sm" onClick={() => deleteN8n.mutate()} disabled={deleteN8n.isPending}>
                  {t("n8n.remove")}
                </Button>
              )}
            </div>

            {generatedSecret ? (
              <div className="rounded-lg border border-dashed border-border bg-surface-2 p-3">
                <p className="mb-1 text-[10px] text-muted">{t("n8n.secretOnce")}</p>
                <code dir="ltr" className="block break-all font-mono text-xs">
                  {generatedSecret}
                </code>
                <p className="mt-2 text-[10px] leading-5 text-muted">{t("n8n.inboundHelp")}</p>
                <code dir="ltr" className="mt-1 block break-all font-mono text-[10px] text-muted">
                  POST {"{"}APP_URL{"}"}/api/integrations/n8n/inbound — x-zaki-org: {"{orgId}"} — x-zaki-token: {"{secret}"}
                </code>
              </div>
            ) : n8n.data?.status.connected ? (
              <p className="text-[10px] text-muted">{t("n8n.secretStored")}</p>
            ) : null}
          </div>
        ) : ctx.orgRole === "GUEST" ? (
          <p className="text-xs text-muted">{t("n8n.guestNote")}</p>
        ) : (
          <p className="text-xs text-muted">{t("n8n.managerOnly")}</p>
        )}

        {/* event log — every attempt, success or failure */}
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-right text-[11px]">
            <thead className="bg-surface-2 text-muted">
              <tr>
                <th className="px-2 py-1.5 font-medium">{t("log.direction")}</th>
                <th className="px-2 py-1.5 font-medium">{t("log.event")}</th>
                <th className="px-2 py-1.5 font-medium">{t("log.status")}</th>
                <th className="px-2 py-1.5 font-medium">{t("log.detail")}</th>
                <th className="px-2 py-1.5 font-medium">{t("log.time")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(n8n.data?.events ?? []).map((ev) => (
                <tr key={ev.id}>
                  <td className="px-2 py-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-mono text-[10px]",
                        ev.direction === "OUT" ? "bg-fuchsia-500/10 text-fuchsia-600" : "bg-sky-500/10 text-sky-600",
                      )}
                    >
                      {ev.direction}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 font-mono">{ev.type}</td>
                  <td className={cn("px-2 py-1.5", ev.status === "OK" ? "text-emerald-600" : "text-red-600")}>{ev.status}</td>
                  <td className="max-w-[16rem] truncate px-2 py-1.5 text-muted" title={ev.detail ?? undefined}>
                    {ev.detail ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-muted">{fmtDateTime(ev.createdAt, locale)}</td>
                </tr>
              ))}
              {(n8n.data?.events.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-center text-muted">
                    {t("log.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- Google Drive ---------------- */}
      <section className="space-y-4 rounded-xl border border-border bg-surface-1 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-lg bg-amber-500/15 text-amber-500">
              <Globe className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Google Drive</h2>
              <p className="text-xs text-muted">{t("google.subtitle")}</p>
            </div>
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              google.data?.connected
                ? "bg-emerald-500/15 text-emerald-600"
                : google.data?.configured
                  ? "bg-surface-2 text-muted"
                  : "bg-amber-500/15 text-amber-600",
            )}
          >
            {google.data?.connected ? t("google.connected") : google.data?.configured ? t("google.notConnected") : t("google.needsEnv")}
          </span>
        </div>

        {!google.data?.configured ? (
          <p className="text-xs leading-6 text-muted">{t("google.envHelp")}</p>
        ) : google.data.connected ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {canManage && (
                <Button variant="secondary" size="sm" onClick={() => setShowFiles((s) => !s)}>
                  <FileText className="size-4" />
                  {showFiles ? t("google.hideFiles") : t("google.viewFiles")}
                </Button>
              )}
              {canManage && (
                <Button variant="danger" size="sm" onClick={() => disconnectGoogle.mutate()} disabled={disconnectGoogle.isPending}>
                  {t("google.disconnect")}
                </Button>
              )}
            </div>
            {google.data.filesError && <p className="text-xs text-red-500">{t(google.data.filesError)}</p>}
            {showFiles && canManage && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {google.data.files?.length ? (
                  google.data.files.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="line-clamp-1 text-xs">{f.name}</span>
                      {f.link && (
                        <a href={f.link} target="_blank" rel="noreferrer" className="text-[10px] text-accent hover:underline">
                          <ExternalLink className="inline size-3" /> {t("google.open")}
                        </a>
                      )}
                    </li>
                  ))
                ) : (
                  <li className="px-3 py-3 text-center text-xs text-muted">{t("google.noFiles")}</li>
                )}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {canManage ? (
              <Link href="/api/integrations/google/start">
                <Button size="sm">
                  <Plug className="size-4" />
                  {t("google.connect")}
                </Button>
              </Link>
            ) : null}
            <p className="text-[10px] text-muted">{t("google.readonlyNote")}</p>
          </div>
        )}
      </section>
    </div>
  );
}

function errText(err: unknown, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (err instanceof ApiError && err.code) {
    const translated = t(err.code);
    return translated !== err.code ? translated : t("common.error");
  }
  return t("common.error");
}
