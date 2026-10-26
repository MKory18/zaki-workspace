"use client";
import React from "react";
import type { ConversationDto, MessageDto } from "@/server/chat/dto";
import { useI18n } from "@/lib/i18n";
import { classifyFile, exceedsKindLimit, MAX_ATTACHMENTS_PER_MESSAGE, type FileKind } from "@/lib/chat/file-kinds";
import { compressImage } from "@/lib/chat/compress-image";
import { buildChatMessagePayload, createChatUploadFormData, createVoiceUploadFormData, enterSends, messageClientId } from "@/lib/chat/conversation/client";
import { findMentionQuery, insertMention, selectedMentionIds } from "@/lib/chat/conversation/mentions";
import { uploadWithProgress } from "@/lib/chat/upload-with-progress";
import { VoiceRecorder, type VoiceTake } from "@/lib/chat/voice-recorder";
import { barsFor, formatDuration } from "@/lib/chat/waveform";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type PendingFile = { file: File; kind: FileKind; preview: string | null };
/** idle: the text row; recording: the mic is open; review: a take that stopped by itself waits for send or cancel. */
type VoiceState = { mode: "idle" } | { mode: "recording"; elapsedMs: number; peaks: number[]; hold: boolean } | { mode: "review"; take: VoiceTake };

/** A finger that slides this far from the mic while holding throws the take away. */
export const HOLD_CANCEL_PX = 80;

const iconButton = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full";

/**
 * `editing`: «تعديل» from the message menu edits IN this box (there is no second edit box): the text is
 * loaded here, «+» and the microphone step aside, and sending saves the edit.
 */
export function ChatComposer({ conversationId, detail, onMessage, reply, onCancelReply, editing = null, onCancelEdit, onEdited }: { conversationId: string; detail: ConversationDto; onMessage: (message: MessageDto) => void; reply: MessageDto | null; onCancelReply: () => void; editing?: MessageDto | null; onCancelEdit?: () => void; onEdited?: (message: MessageDto) => void }) {
 const { t } = useI18n(); const [body,setBody]=React.useState(""); const [files,setFiles]=React.useState<PendingFile[]>([]); const [mentions,setMentions]=React.useState<Array<{id:string;name:string}>>([]); const [busy,setBusy]=React.useState(false); const [error,setError]=React.useState("");
 const [progress, setProgress] = React.useState<number[]>([]);
 const [voice, setVoice] = React.useState<VoiceState>({ mode: "idle" });
 const recorder = React.useRef<VoiceRecorder | null>(null);
 const holdStart = React.useRef<{ x: number; y: number } | null>(null);
 const mediaInput = React.useRef<HTMLInputElement | null>(null);
 const fileInput = React.useRef<HTMLInputElement | null>(null);
 const [clientId, setClientId] = React.useState(() => messageClientId());
 const memberOptions=detail.members??[]; const activeMention=findMentionQuery(body); const query=activeMention?.query??""; const choices=activeMention?memberOptions.filter(m=>m.name.toLowerCase().includes(query.toLowerCase())):[];

 // previews are object URLs: give them back when the file leaves the list, and when the screen goes
 const filesRef = React.useRef(files);
 filesRef.current = files;
 React.useEffect(() => () => {
  for (const f of filesRef.current) if (f.preview) URL.revokeObjectURL(f.preview);
  recorder.current?.cancel(); // never leave the microphone on behind a closed conversation
 }, []);

 // an edit starts with the message's own words in the box, and ends with an empty box
 React.useEffect(() => {
  setBody(editing ? (editing.body ?? "") : "");
  setError("");
 }, [editing]);

 function addFiles(list: FileList | null) {
  if (!list) return;
  const incoming = Array.from(list).map(file => {
   const kind = classifyFile(file);
   return { file, kind, preview: kind === "IMAGE" || kind === "VIDEO" ? URL.createObjectURL(file) : null };
  });
  if (incoming.length) setClientId(messageClientId());
  setFiles(current => [...current, ...incoming]);
 }
 function removeFile(index: number) {
  setClientId(messageClientId());
  setFiles(current => {
   const gone = current[index];
   if (gone?.preview) URL.revokeObjectURL(gone.preview);
   return current.filter((_, i) => i !== index);
  });
 }
 function selectMention(id: string, name: string) {
  setClientId(messageClientId());
  setBody(value => insertMention(value, name));
  setMentions(current => current.some(member => member.id === id) ? current : [...current, { id, name }]);
 }
 const failText = (e: unknown, fallback: string) => {
  const key = e instanceof Error ? e.message : "";
  return key.startsWith("chat.") ? t(key) : key || t(fallback);
 };

 async function postMessage(payload: Parameters<typeof buildChatMessagePayload>[0]) {
  const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
   method: "POST",
   headers: { "content-type": "application/json" },
   body: JSON.stringify(buildChatMessagePayload(payload)),
  });
  if (!response.ok) throw new Error(t("chatc.message_failed"));
  onMessage(await response.json() as MessageDto);
 }

 async function saveEdit() {
  if (!editing || !body.trim()) return;
  setBusy(true);
  setError("");
  try {
   const response = await fetch(`/api/chat/messages/${encodeURIComponent(editing.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: body.trim() }),
   });
   if (!response.ok) throw new Error(t("chatc.message_failed"));
   onEdited?.(await response.json() as MessageDto);
  } catch (e) {
   setError(failText(e, "chatc.message_failed"));
  } finally {
   setBusy(false);
  }
 }

 async function submit(event: React.FormEvent) {
  event.preventDefault();
  if (editing) return void saveEdit();
  if (busy || (!body.trim() && !files.length)) return;
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
   setError(t("chatc.too_many_files"));
   return;
  }
  setBusy(true);
  setError("");
  setProgress(files.map(() => 0));
  try {
   const attachmentIds: string[] = [];
   for (const [index, item] of files.entries()) {
    let upload = item.file;
    if (item.kind === "IMAGE") {
     const compressed = await compressImage(item.file, item.file.name);
     if (compressed) upload = new File([compressed.blob], item.file.name, { type: compressed.mime });
    }
    if (exceedsKindLimit(upload.size, item.kind)) throw new Error(t("chatc.file_too_large"));
    const result = await uploadWithProgress("/api/chat/uploads", createChatUploadFormData(upload, item.kind), percent =>
     setProgress(current => current.map((p, i) => (i === index ? percent : p))),
    );
    if (typeof result["id"] !== "string") throw new Error(t("chatc.upload_failed"));
    attachmentIds.push(result["id"]);
   }
   await postMessage({ body: body.trim(), attachmentIds, mentions: selectedMentionIds(body, mentions), ...(reply ? { replyToId: reply.id } : {}), clientId });
   for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
   setBody("");
   setFiles([]);
   setMentions([]);
   setClientId(messageClientId());
   onCancelReply();
  } catch (e) {
   setError(failText(e, "chatc.upload_failed"));
  } finally {
   setBusy(false);
   setProgress([]);
  }
 }

 // ---------- voice ----------
 async function startRecording(hold: boolean) {
  if (voice.mode !== "idle" || busy) return;
  setError("");
  const rec = new VoiceRecorder({
   onTick: elapsedMs => setVoice(v => (v.mode === "recording" ? { ...v, elapsedMs } : v)),
   onPeaks: peaks => setVoice(v => (v.mode === "recording" ? { ...v, peaks } : v)),
   // the 5-minute cap or a hidden page: the take waits to be sent or thrown away, it is never lost
   onAutoStop: take => { recorder.current = null; setVoice(take ? { mode: "review", take } : { mode: "idle" }); },
  });
  recorder.current = rec;
  setVoice({ mode: "recording", elapsedMs: 0, peaks: [], hold });
  try {
   await rec.start();
   // the finger lifted (or slid away) while the browser was still asking for the microphone
   if (recorder.current !== rec) rec.cancel();
  } catch (e) {
   recorder.current = null;
   setVoice({ mode: "idle" });
   const key = e instanceof Error ? e.name : "";
   setError(key.startsWith("mic.") ? t(`chat.f.${key}`) : t("chat.f.mic.unavailable"));
  }
 }
 function cancelRecording() {
  recorder.current?.cancel();
  recorder.current = null;
  holdStart.current = null;
  setVoice({ mode: "idle" });
 }
 async function sendVoice(take?: VoiceTake | null) {
  let recording = take ?? null;
  if (!recording && recorder.current) {
   recording = await recorder.current.stop();
   recorder.current = null;
  }
  holdStart.current = null;
  setVoice({ mode: "idle" });
  if (!recording || recording.durationMs < 500) return; // a slip of the finger, not a message
  setBusy(true);
  setError("");
  setProgress([0]);
  try {
   const result = await uploadWithProgress("/api/chat/uploads", createVoiceUploadFormData(recording), percent => setProgress([percent]));
   if (typeof result["id"] !== "string") throw new Error(t("chat.f.upload_failed"));
   await postMessage({ body: "", attachmentIds: [result["id"]], mentions: [], ...(reply ? { replyToId: reply.id } : {}), clientId: messageClientId(), voice: true });
   onCancelReply();
  } catch (e) {
   setError(failText(e, "chat.f.upload_failed"));
  } finally {
   setBusy(false);
   setProgress([]);
  }
 }
 // On a phone: press and hold to record, lift to send, slide away to cancel. The recording bar replaces
 // the mic as soon as the hold starts, so the finger is followed on the window, not on the button.
 // With a mouse (or a keyboard) a click opens the bar, with its own cancel and send.
 const lastPointer = React.useRef<string>("mouse");
 function onMicPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
  lastPointer.current = event.pointerType;
  if (event.pointerType === "mouse") return;
  event.preventDefault();
  const start = { x: event.clientX, y: event.clientY };
  holdStart.current = start;
  const done = () => {
   window.removeEventListener("pointermove", move);
   window.removeEventListener("pointerup", up);
   window.removeEventListener("pointercancel", cancel);
  };
  const move = (e: PointerEvent) => {
   if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > HOLD_CANCEL_PX) { done(); cancelRecording(); }
  };
  const up = () => { done(); void sendVoice(); };
  const cancel = () => { done(); cancelRecording(); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  void startRecording(true);
 }
 function onMicClick() {
  // a tap on a phone also fires `click` after the hold: the hold already handled it
  if (lastPointer.current !== "mouse") { lastPointer.current = "mouse"; return; }
  void startRecording(false);
 }

 const empty = !body.trim() && !files.length && !editing;
 const recording = voice.mode === "recording" ? voice : null;

 if (recording || voice.mode === "review") {
  const elapsed = recording ? recording.elapsedMs : voice.mode === "review" ? voice.take.durationMs : 0;
  const peaks = recording ? recording.peaks : voice.mode === "review" ? voice.take.peaks : [];
  return (
   <div className="flex flex-col gap-2" data-recording={voice.mode}>
    <div className="flex items-center gap-2 rounded-full border border-border bg-surface-1 p-1">
     <button type="button" className={`${iconButton} text-danger`} aria-label={t("chat.f.cancel_recording")} onClick={cancelRecording}>
      <span aria-hidden="true">✕</span>
     </button>
     <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full bg-danger ${recording ? "motion-safe:animate-pulse" : "opacity-40"}`} />
     <span role="timer" aria-live="off" className="w-12 shrink-0 text-sm tabular-nums" dir="ltr">{formatDuration(elapsed)}</span>
     <div aria-hidden="true" className="flex h-8 flex-1 items-center gap-px overflow-hidden" dir="ltr">
      {barsFor(peaks, 32).map((p, i) => <span key={i} className="w-1 rounded-full bg-accent" style={{ height: `${Math.max(12, p)}%` }} />)}
     </div>
     <button
      type="button"
      className={`${iconButton} bg-accent text-accent-fg`}
      aria-label={t("chat.f.send_recording")}
      onClick={() => void sendVoice(voice.mode === "review" ? voice.take : null)}
     >
      <span aria-hidden="true">➤</span>
     </button>
    </div>
    <p className="text-center text-xs text-fg-muted" aria-live="polite">{recording?.hold ? t("chat.f.recording_hint") : recording ? t("chat.f.recording") : t("chat.f.voice_label")}</p>
    {error && <p role="alert">{error}</p>}
   </div>
  );
 }

 return (
  <form onSubmit={submit} className="flex flex-col gap-2">
   {editing && (
    <div className="flex items-center justify-between gap-2 rounded-md border-s-4 border-accent bg-surface-1 px-3 py-1 text-sm">
     <span>{t("chatc.editing")}</span>
     <button type="button" className="min-h-11 px-2" onClick={() => onCancelEdit?.()}>{t("chatc.cancel")}</button>
    </div>
   )}
   {files.length > 0 && (
    <ul className="flex flex-wrap gap-2" aria-label={t("chatc.attach")}>
     {files.map((item, index) => (
      <li key={`${item.file.name}-${index}`} className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-1 text-xs">
       {item.kind === "IMAGE" && item.preview
        // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview, nothing for next/image to optimise
        ? <img src={item.preview} alt={item.file.name} className="h-full w-full object-cover" />
        : item.kind === "VIDEO" && item.preview
         ? <video src={item.preview} muted preload="metadata" className="h-full w-full object-cover" aria-label={item.file.name} />
         : <span className="line-clamp-3 break-all p-1 text-center">{item.file.name}</span>}
       {!busy && (
        <button
         type="button"
         className="absolute end-0 top-0 flex h-6 w-6 items-center justify-center rounded-full bg-surface text-fg shadow"
         aria-label={t("chat.f.remove", { name: item.file.name })}
         onClick={() => removeFile(index)}
        >
         <span aria-hidden="true">×</span>
        </button>
       )}
       {busy && progress[index] !== undefined && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress[index]} aria-label={t("chat.f.progress", { name: item.file.name, percent: progress[index] ?? 0 })}>
         <span className="block h-full bg-accent" style={{ width: `${progress[index]}%` }} />
        </span>
       )}
      </li>
     ))}
    </ul>
   )}
   {choices.length > 0 && (
    <ul aria-label={t("chatc.mention")} className="rounded-md border border-border">
     {choices.map(member => (
      <li key={member.id}>
       <button type="button" className="min-h-11 w-full px-3 text-start" onClick={() => selectMention(member.id, member.name)}>
        {member.name}
       </button>
      </li>
     ))}
    </ul>
   )}
   <div className="flex items-end gap-2">
    {!editing && <DropdownMenu>
     <DropdownMenuTrigger asChild>
      <button type="button" className={`${iconButton} border border-border text-xl`} aria-label={t("chat.f.attach_menu")} disabled={busy}>
       <span aria-hidden="true">+</span>
      </button>
     </DropdownMenuTrigger>
     <DropdownMenuContent align="start">
      <DropdownMenuItem onSelect={() => mediaInput.current?.click()}>{t("chat.f.attach_media")}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => fileInput.current?.click()}>{t("chat.f.attach_file")}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void startRecording(false)}>{t("chat.f.voice_label")}</DropdownMenuItem>
     </DropdownMenuContent>
    </DropdownMenu>}
    <input ref={mediaInput} type="file" accept="image/*,video/*" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => { addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => { addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <label className="sr-only" htmlFor="chat-message">{t("chatc.message")}</label>
    <textarea
     id="chat-message"
     rows={1}
     value={body}
     onChange={event => { setClientId(messageClientId()); setBody(event.currentTarget.value); }}
     // Enter sends (the owner, 2026-10-26), Shift+Enter is a new line; never while an input method is composing a word
     onKeyDown={event => { if (enterSends({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) { event.preventDefault(); if (body.trim()) event.currentTarget.form?.requestSubmit(); } }}
     enterKeyHint="send"
     className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl border border-border bg-surface px-3 py-2 text-base"
     placeholder={t("chatc.message")}
    />
    {empty ? (
     <button
      type="button"
      className={`${iconButton} bg-accent text-accent-fg touch-none select-none`}
      aria-label={t("chat.f.record")}
      title={t("chat.f.hold_to_record")}
      disabled={busy}
      onClick={onMicClick}
      onPointerDown={onMicPointerDown}
     >
      <span aria-hidden="true">🎤</span>
     </button>
    ) : (
     <button type="submit" disabled={busy || (editing !== null && !body.trim())} className={`${iconButton} bg-accent text-accent-fg`} aria-label={editing ? t("chatc.save") : busy ? t("chatc.sending") : t("chatc.send")}>
      <span aria-hidden="true">{busy ? "…" : "➤"}</span>
     </button>
    )}
   </div>
   {busy && files.length === 0 && progress.length > 0 && <p className="text-xs text-fg-muted" role="status">{t("chat.f.uploading")}</p>}
   {error && <p role="alert">{error}</p>}
  </form>
 );
}
