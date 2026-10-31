"use client";

import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { apiUpload } from "@/lib/api-client";
import { fmtSize } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { APPROVAL_LIMITS } from "@/lib/approvals/shared";
import type { AttachmentView } from "@/lib/approvals/view";
import { Button } from "@/components/ui/button";
import { errorText } from "./errors";

export interface PickedFile {
  id: string;
  name: string;
  size: number;
}

/** The kind the upload route wants declared (it sniffs the bytes and refuses a kind that disagrees): by the browser's own type. */
export function kindOf(mime: string): "IMAGE" | "VIDEO" | "AUDIO" | "FILE" {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "AUDIO";
  return "FILE";
}

/**
 * «مرفقات»: files go through the chat's own upload route (`POST /api/chat/uploads`: the bytes decide the kind, the size is
 * limited there) and the request keeps only the ids. No new upload path, no new table of files.
 */
export function AttachmentPicker({ value, onChange }: { value: PickedFile[]; onChange: (next: PickedFile[]) => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const next = [...value];
      for (const file of Array.from(files)) {
        if (next.length >= APPROVAL_LIMITS.attachments) {
          setError(t("approvals.e.files_many"));
          break;
        }
        const form = new FormData();
        form.set("kind", kindOf(file.type));
        form.set("file", file);
        const made = await apiUpload<{ id: string; size: number }>("/api/chat/uploads", form);
        next.push({ id: made.id, name: file.name, size: made.size });
      }
      onChange(next);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2" data-attachment-picker>
      {value.length > 0 ? (
        <ul className="space-y-1">
          {value.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-sm">
              <Paperclip className="size-4 shrink-0 text-fg-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-fg">{f.name}</span>
              <span className="text-xs text-fg-muted">{fmtSize(f.size)}</span>
              <Button type="button" variant="ghost" size="icon" aria-label={t("approvals.files.remove")} onClick={() => onChange(value.filter((x) => x.id !== f.id))}>
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <input ref={input} type="file" multiple className="sr-only" aria-label={t("approvals.files.add")} onChange={(e) => void add(e.target.files)} />
      <Button type="button" variant="secondary" size="sm" disabled={busy || value.length >= APPROVAL_LIMITS.attachments} onClick={() => input.current?.click()}>
        <Paperclip className="size-4" aria-hidden />
        {busy ? t("approvals.files.uploading") : t("approvals.files.add")}
      </Button>
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The files of a request, each one a download link through the one file route (it lets in only the people who may read the request). */
export function AttachmentList({ files }: { files: AttachmentView[] }) {
  const { t } = useI18n();
  if (files.length === 0) return <p className="text-xs text-fg-muted">{t("approvals.files.none")}</p>;
  return (
    <ul className="space-y-1" data-attachment-list>
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2 text-sm">
          <Paperclip className="size-4 shrink-0 text-fg-muted" aria-hidden />
          <a href={`${f.url}?download=1`} className="min-w-0 flex-1 truncate text-accent hover:underline">
            {f.name}
          </a>
          <span className="text-xs text-fg-muted">{fmtSize(f.size)}</span>
        </li>
      ))}
    </ul>
  );
}
