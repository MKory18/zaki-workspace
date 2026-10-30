"use client";

import * as React from "react";
import { ArrowRight, ArrowLeft, Download, ImageOff, Paperclip, Star, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmtSize } from "@/lib/format";
import { apiDelete, apiPatch, apiPost, apiPut, apiUpload } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOptionalToast } from "@/components/ui/toast";
import { LIMITS } from "@/lib/cards/shared";
import type { GalleryItem } from "@/lib/cards/page";
import { cardErrorKey } from "./errors";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function Caption({ item, editable, onSave }: { item: GalleryItem; editable: boolean; onSave: (caption: string | null) => Promise<void> }) {
  const { t } = useI18n();
  const [text, setText] = React.useState(item.caption ?? "");
  if (!editable) return item.caption ? <p dir="auto" className="break-words text-sm text-fg">{item.caption}</p> : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(text.trim() ? text.trim() : null);
      }}
      className="flex items-center gap-1"
    >
      <Input value={text} maxLength={LIMITS.caption} onChange={(e) => setText(e.target.value)} aria-label={t("cards.p.gallery_caption")} placeholder={t("cards.p.gallery_caption")} />
      <Button type="submit" size="sm" variant="secondary" disabled={(item.caption ?? "") === text.trim()}>
        {t("cards.p.gallery_caption_save")}
      </Button>
    </form>
  );
}

/**
 * «المعرض»: the card's pictures and files in the order the team chose, each with a caption, and one of them may be the
 * cover. The bytes are the file library's: a picture is uploaded through the library's own route (which sniffs it and
 * limits it) and only then linked to the card. Anybody who may write can add, caption, reorder and remove.
 */
export function GallerySection({
  cardId,
  gallery,
  canEdit,
  hasLibrary,
  version,
  onChanged,
  upload,
}: {
  cardId: string;
  gallery: GalleryItem[];
  canEdit: boolean;
  /** The viewer holds the library's box (without it the server sends no gallery at all). */
  hasLibrary: boolean;
  version?: number;
  /** The gallery or the cover changed: the page reads itself again. */
  onChanged: () => void;
  /** Sends a picked file to the library of this space; tests pass their own. */
  upload?: (file: File) => Promise<{ id: string }>;
}) {
  void version;
  const { t } = useI18n();
  const toast = useOptionalToast()?.toast;
  const [busy, setBusy] = React.useState(false);
  const send = upload ?? (async (file: File) => apiUpload<{ id: string }>("/api/files", (() => { const f = new FormData(); f.append("file", file); return f; })()));

  const run = async (job: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await job();
      if (done) toast?.(t(done), "success");
      onChanged();
    } catch (err) {
      toast?.(t(cardErrorKey(err)), "error");
    } finally {
      setBusy(false);
    }
  };

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    e.target.value = "";
    if (!chosen) return;
    await run(async () => {
      const made = await send(chosen);
      await apiPost(`/api/cards/${cardId}/attachments`, { fileId: made.id });
    }, "cards.p.gallery_added");
  }

  function move(index: number, by: -1 | 1) {
    const ids = gallery.map((g) => g.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void run(() => apiPut(`/api/cards/${cardId}/attachments/order`, { ids }));
  }

  return (
    <section aria-label={t("cards.p.tab.gallery")} className="flex flex-col gap-3">
      {canEdit && hasLibrary && gallery.length < LIMITS.attachments ? (
        <div className="flex flex-col gap-1">
          <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-muted bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2">
            <input type="file" className="sr-only" onChange={(e) => void pick(e)} disabled={busy} />
            {busy ? t("cards.p.gallery_uploading") : t("cards.p.gallery_add")}
          </label>
          <p className="text-xs text-fg-muted">{t("cards.p.gallery_hint")}</p>
        </div>
      ) : null}
      {gallery.length === 0 ? <p className="text-sm text-fg-muted">{t("cards.p.gallery_empty")}</p> : null}
      <ul className="m-0 grid gap-3 p-0 sm:grid-cols-2">
        {gallery.map((item, index) => {
          const raw = `/api/files/${item.fileId}/raw`;
          const isImage = IMAGE_TYPES.has(item.file.mimeType);
          return (
            <li key={item.id} data-attachment-id={item.id} className="flex list-none flex-col gap-2 rounded-xl border border-border bg-surface p-2">
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={raw} alt={item.caption ?? item.file.name} loading="lazy" className="max-h-64 w-full rounded-lg border border-border bg-surface-2 object-contain" />
              ) : (
                <div className="flex min-h-24 items-center justify-center rounded-lg border border-border bg-surface-2 text-fg-muted">
                  {item.file.mimeType.startsWith("image/") ? <ImageOff className="size-6" aria-hidden="true" /> : <Paperclip className="size-6" aria-hidden="true" />}
                </div>
              )}
              <p dir="auto" className="truncate text-xs text-fg-muted">
                {item.file.name} · {fmtSize(item.file.size)}
              </p>
              <Caption key={`${item.id}:${item.caption ?? ""}`} item={item} editable={canEdit} onSave={(caption) => run(() => apiPatch(`/api/cards/${cardId}/attachments/${item.id}`, { caption }))} />
              <div className="flex flex-wrap items-center gap-1">
                <a href={`${raw}?download=1`} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg">
                  <Download className="size-4" aria-hidden="true" />
                  {t("cards.p.gallery_download")}
                </a>
                {canEdit ? (
                  <>
                    {isImage ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(() => apiPut(`/api/cards/${cardId}/cover`, { fileId: item.isCover ? null : item.fileId }))}
                        aria-pressed={item.isCover}
                        className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
                      >
                        <Star className={item.isCover ? "size-4 fill-current text-warn" : "size-4"} aria-hidden="true" />
                        {item.isCover ? t("cards.p.gallery_cover_off") : t("cards.p.gallery_cover")}
                      </button>
                    ) : null}
                    <button type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={t("cards.p.gallery_earlier")} className="inline-flex size-11 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40">
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </button>
                    <button type="button" disabled={busy || index === gallery.length - 1} onClick={() => move(index, 1)} aria-label={t("cards.p.gallery_later")} className="inline-flex size-11 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40">
                      <ArrowLeft className="size-4" aria-hidden="true" />
                    </button>
                    <button type="button" disabled={busy} onClick={() => void run(() => apiDelete(`/api/cards/${cardId}/attachments/${item.id}`), "cards.p.gallery_removed")} aria-label={t("cards.p.gallery_remove")} className="inline-flex size-11 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-danger">
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
