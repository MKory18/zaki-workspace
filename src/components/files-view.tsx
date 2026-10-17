"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, FileArchive, FileAudio, FileImage, FileText, FileVideo, FolderUp, History, Trash2, UploadCloud } from "lucide-react";
import { apiDelete, apiGet, ApiError, apiUpload } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { fmtShort } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface FileRow {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  version: number;
  versions: number;
  previewable: boolean;
  uploader: string;
  uploaderId: string;
  createdAt: string;
  familyId: string;
}

interface FileMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  version: number;
  versions: Array<{ id: string; version: number; size: number; createdAt: string; uploader: string }>;
  previewable: boolean;
  uploader: string;
  uploaderId: string;
}

export function FilesView({ me }: { me: { id: string; role: string } }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<FileRow | null>(null);
  const [versioning, setVersioning] = useState<FileRow | null>(null);
  const [dragging, setDragging] = useState(false);

  const list = useQuery({
    queryKey: ["files", "list"],
    queryFn: () => apiGet<{ files: FileRow[] }>("/api/files"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["files", "list"] });
    qc.invalidateQueries({ queryKey: ["files", "meta"] });
  };

  const fileErr = (err: unknown) => {
    if (err instanceof ApiError) {
      const key = err.messageKey ?? err.code;
      const plain = t(key);
      toast(plain === key ? t("common.error") : plain, "error");
    } else {
      toast(t("common.error"), "error");
    }
  };

  const upload = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.set("file", f);
      return apiUpload<{ id: string }>("/api/files", form);
    },
    onSuccess: () => invalidate(),
    onError: fileErr,
  });

  const addVersion = useMutation({
    mutationFn: (input: { file: File; targetId: string }) => {
      const form = new FormData();
      form.set("file", input.file);
      return apiUpload<{ id: string }>(`/api/files/${input.targetId}/versions`, form);
    },
    onSuccess: () => {
      invalidate();
      setVersioning(null);
      toast(t("files.newVersion"), "success");
    },
    onError: fileErr,
  });

  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/files/${id}`),
    onSuccess: () => {
      invalidate();
      toast(t("files.deleted"), "success");
    },
    onError: fileErr,
  });

  const canManage = (f: FileRow) => f.uploaderId === me.id || me.role === "OWNER" || me.role === "ADMIN";
  const files = list.data?.files ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{t("files.title")}</h1>
          <p className="text-xs text-muted">{t("files.empty_desktop")}</p>
        </div>
        {me.role !== "GUEST" && (
          <Button size="sm" onClick={() => fileInputRef.current?.click()}>
            <FolderUp className="size-4" />
            {t("files.upload")}
          </Button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => e.target.files && Array.from(e.target.files).forEach((f) => upload.mutate(f))}
        />
      </header>

      {me.role !== "GUEST" && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            Array.from(e.dataTransfer.files).forEach((f) => upload.mutate(f));
          }}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          className={cn(
            "grid place-items-center gap-1 rounded-xl border-2 border-dashed border-border px-4 py-6 text-center text-xs text-muted transition-colors",
            dragging && "border-accent text-accent",
          )}
        >
          <UploadCloud className="size-5" />
          <span className="font-medium">{t("files.upload")}</span>
          <span>{t("files.empty_desktop")}</span>
        </div>
      )}

      {files.length === 0 ? (
        <p className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-muted">{t("files.empty")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {files.map((f) => (
            <li key={f.id} className="rounded-xl border border-border bg-surface-1 p-3">
              <div className="flex items-start gap-2">
                <TypeGlyph mime={f.mimeType} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{f.name}</p>
                  <p className="text-[11px] text-muted">
                    {t("files.v_line", { n: f.version })} · {humanSize(f.size)} · {t("files.by", { who: f.uploader })}
                  </p>
                  {f.versions > 1 && (
                    <button
                      type="button"
                      className="text-[11px] text-accent hover:underline"
                      onClick={() => setVersioning(f)}
                    >
                      {t("files.line", { n: f.version, m: f.versions })}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {f.previewable && (
                    <Button size="sm" variant="ghost" aria-label={t("files.preview")} onClick={() => setPreview(f)}>
                      <Eye className="size-4" />
                    </Button>
                  )}
                  <a href={`/api/files/${f.id}/raw?download=1`} download>
                    <Button size="sm" variant="ghost" aria-label={t("files.download")}>
                      <Download className="size-4" />
                    </Button>
                  </a>
                  {canManage(f) && (
                    <Button size="sm" variant="ghost" aria-label={`${t("common.delete")}`} onClick={() => del.mutate(f.id)} disabled={del.isPending}>
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  )}
                </div>
              </div>
              {f.mimeType.startsWith("image/") && (
                <a href={`/api/files/${f.id}/raw`} target="_blank" rel="noreferrer" className="mt-2 block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${f.id}/raw`} alt={f.name} className="h-28 w-full rounded-lg object-cover" loading="lazy" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {preview && <PreviewModal file={preview} onClose={() => setPreview(null)} />}

      {versioning && (
        <VersionModal
          row={versioning}
          canUpload={me.role !== "GUEST"}
          onUpload={(file) => addVersion.mutate({ file, targetId: versioning.id })}
          uploading={addVersion.isPending}
          onClose={() => setVersioning(null)}
        />
      )}
    </div>
  );
}

function TypeGlyph({ mime }: { mime: string }) {
  const cls = "size-8 shrink-0 p-1.5 rounded-lg bg-surface-2";
  if (mime.startsWith("image/")) return <FileImage className={cn(cls, "text-emerald-500")} />;
  if (mime.startsWith("video/")) return <FileVideo className={cn(cls, "text-indigo-500")} />;
  if (mime.startsWith("audio/")) return <FileAudio className={cn(cls, "text-fuchsia-500")} />;
  if (mime === "application/pdf" || mime === "text/plain") return <FileText className={cn(cls, "text-sky-500")} />;
  return <FileArchive className={cn(cls, "text-amber-500")} />;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function PreviewModal({ file, onClose }: { file: FileRow; onClose: () => void }) {
  const { t, locale } = useI18n();
  const src = `/api/files/${file.id}/raw`;
  return (
    <Modal open onClose={onClose} title={file.name}>
      <div className="max-h-[70vh] overflow-auto">
        {file.mimeType.startsWith("image/") && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={file.name} className="mx-auto max-h-[60vh] rounded-lg" />
        )}
        {file.mimeType.startsWith("video/") && <video src={src} controls className="mx-auto max-h-[60vh] rounded-lg" />}
        {file.mimeType.startsWith("audio/") && <audio src={src} controls className="w-full px-4 py-8" />}
        {file.mimeType === "application/pdf" && <iframe src={src} title={file.name} className="h-[60vh] w-full rounded-lg" />}
        {file.mimeType === "text/plain" && <TextPreview src={src} />}
      </div>
    </Modal>
  );
}

function TextPreview({ src }: { src: string }) {
  const { data } = useQuery({
    queryKey: ["files", "text", src],
    queryFn: () => fetch(src).then((r) => r.text()),
  });
  return (
    <pre className="whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-xs" dir="auto">
      {data}
    </pre>
  );
}

function VersionModal({
  row,
  canUpload,
  onUpload,
  uploading,
  onClose,
}: {
  row: FileRow;
  canUpload: boolean;
  onUpload: (f: File) => void;
  uploading: boolean;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const meta = useQuery({
    queryKey: ["files", "meta", row.id],
    queryFn: () => apiGet<FileMeta>(`/api/files/${row.id}`),
  });

  return (
    <Modal open onClose={onClose} title={`${row.name} — ${t("files.versions")}`}>
      <div className="space-y-3">
        <ul className="max-h-64 space-y-1.5 overflow-y-auto">
          {(meta.data?.versions ?? []).map((v) => (
            <li key={v.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs">
              <History className="size-3.5 text-muted" />
              <span className="font-medium">{t("files.v_line", { n: v.version })}</span>
              <span className="flex-1 truncate text-muted">
                {t("files.by", { who: v.uploader })} · {humanSize(v.size)} · {fmtShort(v.createdAt, locale)}
              </span>
              <a href={`/api/files/${v.id}/raw?download=1`} download className="text-accent hover:underline">
                {t("files.download")}
              </a>
            </li>
          ))}
        </ul>
        {canUpload && (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-4 text-sm text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <UploadCloud className="size-4" />
              {t("files.newVersion")} (v{(meta.data?.version ?? row.version) + 1})
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  onUpload(e.target.files[0]);
                  e.target.value = "";
                }
              }}
            />
          </>
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
