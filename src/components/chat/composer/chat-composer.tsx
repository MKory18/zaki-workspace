"use client";
import React from "react";
import type { ConversationDto, MessageDto } from "@/server/chat/dto";
import { useI18n } from "@/lib/i18n";
import { classifyFile, exceedsKindLimit, MAX_ATTACHMENTS_PER_MESSAGE, type FileKind } from "@/lib/chat/file-kinds";
import { compressImage } from "@/lib/chat/compress-image";
import { buildChatMessagePayload, createChatUploadFormData, messageClientId } from "@/lib/chat/conversation/client";
import { findMentionQuery, insertMention, selectedMentionIds } from "@/lib/chat/conversation/mentions";

type PendingFile = { file: File; kind: FileKind };
export function ChatComposer({ conversationId, detail, onMessage, reply, onCancelReply }: { conversationId: string; detail: ConversationDto; onMessage: (message: MessageDto) => void; reply: MessageDto | null; onCancelReply: () => void }) {
 const { t } = useI18n(); const [body,setBody]=React.useState(""); const [files,setFiles]=React.useState<PendingFile[]>([]); const [mentions,setMentions]=React.useState<Array<{id:string;name:string}>>([]); const [busy,setBusy]=React.useState(false); const [error,setError]=React.useState("");
 const [clientId, setClientId] = React.useState(() => messageClientId());
 const memberOptions=detail.members??[]; const activeMention=findMentionQuery(body); const query=activeMention?.query??""; const choices=activeMention?memberOptions.filter(m=>m.name.toLowerCase().includes(query.toLowerCase())):[];
 function addFiles(list: FileList | null) {
  if (!list) return;
  const incoming = Array.from(list).map(file => ({ file, kind: classifyFile(file) }));
  if (incoming.length) setClientId(messageClientId());
  setFiles(current => [...current, ...incoming]);
 }
 function selectMention(id: string, name: string) {
  setClientId(messageClientId());
  setBody(value => insertMention(value, name));
  setMentions(current => current.some(member => member.id === id) ? current : [...current, { id, name }]);
 }
 async function submit(event: React.FormEvent) {
  event.preventDefault();
  if (busy || (!body.trim() && !files.length)) return;
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
   setError(t("chatc.too_many_files"));
   return;
  }
  setBusy(true);
  setError("");
  try {
   const attachmentIds: string[] = [];
   for (const item of files) {
    let upload = item.file;
    if (item.kind === "IMAGE") {
     const compressed = await compressImage(item.file, item.file.name);
     if (compressed) upload = new File([compressed.blob], item.file.name, { type: compressed.mime });
    }
    if (exceedsKindLimit(upload.size, item.kind)) throw new Error(t("chatc.file_too_large"));
    const data = createChatUploadFormData(upload, item.kind);
    const uploadResponse = await fetch("/api/chat/uploads", { method: "POST", body: data });
    if (!uploadResponse.ok) throw new Error(t("chatc.upload_failed"));
    const result = await uploadResponse.json() as { id: string };
    if (!result.id) throw new Error(t("chatc.upload_failed"));
    attachmentIds.push(result.id);
   }
   const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildChatMessagePayload({
     body: body.trim(),
     attachmentIds,
     mentions: selectedMentionIds(body, mentions),
     ...(reply ? { replyToId: reply.id } : {}),
     clientId: clientId,
    })),
   });
   if (!response.ok) throw new Error(t("chatc.message_failed"));
   onMessage(await response.json() as MessageDto);
   setBody("");
   setFiles([]);
   setMentions([]);
   setClientId(messageClientId());
   onCancelReply();
  } catch (e) {
   setError(e instanceof Error ? e.message : t("chatc.upload_failed"));
  } finally {
   setBusy(false);
  }
 }
 return (
  <form onSubmit={submit} className="flex flex-col gap-2">
   <label className="sr-only" htmlFor="chat-message">{t("chatc.message")}</label>
   <textarea
    id="chat-message"
    value={body}
    onChange={event => { setClientId(messageClientId()); setBody(event.currentTarget.value); }}
    className="w-full min-h-11 resize-y rounded-md border border-border bg-background p-2 text-base"
    placeholder={t("chatc.message")}
   />
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
   <label className="min-h-11 w-fit cursor-pointer rounded-md border border-border px-3 py-2">
    {t("chatc.attach")}
    <input
     aria-label={t("chatc.attach")}
     type="file"
     multiple
     className="sr-only"
     onChange={event => { addFiles(event.currentTarget.files); event.currentTarget.value = ""; }}
    />
   </label>
   {files.length > 0 && (
    <ul>
     {files.map((item, index) => (
      <li key={`${item.file.name}-${index}`} className="flex items-center gap-2">
       <span>{item.file.name}</span>
       <button
        type="button"
        className="min-h-11 px-3"
        aria-label={`${t("chatc.remove_file")} ${item.file.name}`}
        onClick={() => { setClientId(messageClientId()); setFiles(current => current.filter((_, i) => i !== index)); }}
       >
        {t("chatc.remove_file")}
       </button>
      </li>
     ))}
    </ul>
   )}
   {error && <p role="alert">{error}</p>}
   <button
    type="submit"
    disabled={busy || (!body.trim() && !files.length)}
    className="min-h-11 self-end rounded-md border border-border px-3 py-2"
   >
    {busy ? t("chatc.sending") : t("chatc.send")}
   </button>
  </form>
 );
}
