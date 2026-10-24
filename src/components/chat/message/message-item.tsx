import React from "react";
import type { MessageDto, ReaderDto } from "@/server/chat/dto";
import { Avatar } from "@/components/ui/avatar";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { systemSentence } from "@/lib/chat/system-sentence";
import { VoicePlayer } from "@/components/chat/message/voice-player";
import { MessageMenu, LONG_PRESS_MS } from "@/components/chat/message/message-menu";
import type { MessageMenuContext, MessageMenuId } from "@/components/chat/message/message-menu-registry";
/**
 * One message. Its actions live in ONE menu (message-menu.tsx), never as buttons under the bubble:
 * «⋯» beside it with a mouse or the keyboard, a long press on a phone. What the menu offers comes from
 * message-menu-registry.ts, which mirrors the server's rules.
 */
export interface MessageItemProps { message: MessageDto; canModerate: boolean; oversight?: boolean; readers?: ReaderDto[]; conversationKind?: "DM" | "GROUP" | "TOPIC"; canPost?: boolean; onReact: (message: MessageDto, emoji: string) => void; onAction: (message: MessageDto, id: MessageMenuId) => void }
const safeMediaUrl = (url: string) => url.startsWith("/api/chat/attachments/") ? url : undefined;
const MAX_READER_AVATARS = 5;
/** DM ticks on my own message: ✓ sent, ✓✓ delivered (both muted), ✓✓ read in the info colour; the word is for screen readers. */
export function MessageTicks({status}:{status:NonNullable<MessageDto["status"]>}){const label=AR[`chatc.tick.${status}`]??"";return <span data-ticks={status} className={`ms-2 text-xs ${status==="read"?"text-info":"text-fg-muted"}`}><span aria-hidden="true">{status==="sent"?"✓":"✓✓"}</span><span className="sr-only">{label}</span></span>;}
/** The small row of people whose newest read message is this one (topics and groups), five at most and «+n». */
export function ReaderRow({readers}:{readers:ReaderDto[]}){if(!readers.length)return null;const shown=readers.slice(0,MAX_READER_AVATARS);const more=readers.length-shown.length;const names=shown.map(r=>r.name).join("، ")+(more>0?` ${interpolate(AR["chatc.readers_more"]??"",{count:more})}`:"");return <div data-readers className="mt-1 flex justify-end gap-0.5" role="img" aria-label={interpolate(AR["chatc.readers"]??"",{names})}>{shown.map(r=><Avatar key={r.userId} name={r.name} className="h-6 w-6"/>)}{more>0&&<span aria-hidden="true" className="self-center text-xs text-fg-muted">+{more}</span>}</div>;}
export function MessageItem({message,canModerate,oversight=false,readers=[],conversationKind="TOPIC",canPost=true,onReact,onAction}: MessageItemProps) {
 const [sheetOpen,setSheetOpen]=React.useState(false);
 const press=React.useRef<{timer:ReturnType<typeof setTimeout>;x:number;y:number}|null>(null);
 const canAct=!oversight&&!message.deleted&&message.kind!=="SYSTEM";
 // a system line is a quiet sentence in the middle, never a bubble with an empty body
 if(message.kind==="SYSTEM")return <p dir="rtl" role="note" className="my-2 text-center text-xs text-fg-muted">{systemSentence(message.system,message.authorName)}</p>;
 const context:MessageMenuContext={mine:message.mine,deleted:message.deleted,kind:message.kind,hasText:Boolean(message.body&&message.body.trim()),pinned:message.pinned,conversationKind,canPost,canModerate,oversight};
 // a phone's long press opens the menu sheet; moving the finger (a scroll) or lifting early is no press
 const endPress=()=>{if(press.current){clearTimeout(press.current.timer);press.current=null;}};
 const onPointerDown=(e:React.PointerEvent)=>{if(e.pointerType==="mouse"||!canAct)return;const {clientX:x,clientY:y}=e;press.current={x,y,timer:setTimeout(()=>{press.current=null;setSheetOpen(true);},LONG_PRESS_MS)};};
 const onPointerMove=(e:React.PointerEvent)=>{const p=press.current;if(p&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>10)endPress();};
 return <div className="group mb-3"><div className={`flex items-center gap-1 ${message.mine?"flex-row":"flex-row-reverse justify-end"}`}><article dir="rtl" data-message-id={message.id} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPress} onPointerCancel={endPress} onContextMenu={e=>{if(sheetOpen||press.current)e.preventDefault();}} className={`${message.mine?"ms-auto":""} max-w-[85%] rounded-xl border border-border bg-surface p-3 [@media(hover:none)]:select-none`}><p className="mb-1 text-xs text-fg-muted">{message.authorName}</p>{message.replyTo&&<blockquote className="mb-2 border-s-2 border-border ps-2 text-sm">{message.replyTo.authorName}: {message.replyTo.deleted?"حُذفت الرسالة":message.replyTo.preview??"رسالة"}</blockquote>}{message.deleted?<p>حُذفت الرسالة</p>:message.body&&<p className="whitespace-pre-wrap">{message.body}</p>}{message.edited&&<small>معدّلة</small>}{message.pinned&&<small className="ms-2">مثبّتة</small>}{message.mine&&message.status&&!message.deleted&&<MessageTicks status={message.status}/>}{message.attachments.map(file=>{const url=safeMediaUrl(file.url); if(!url)return <a key={file.id} href="#" aria-disabled="true">{file.name}</a>; if(message.kind==="VOICE"&&file.mime.startsWith("audio/"))return <VoicePlayer key={file.id} src={url} peaks={file.peaks} durationMs={file.durationMs}/>; return <div key={file.id} className="my-2"><a href={url} download={file.name} className="underline">تنزيل {file.name}</a>{file.kind==="IMAGE"&&file.mime.startsWith("image/")&&<img src={url} alt={file.name} loading="lazy" className="mt-1 max-h-80 max-w-full rounded-md"/>}{file.kind==="VIDEO"&&file.mime.startsWith("video/")&&<video src={url} controls preload="metadata" className="mt-1 max-h-80 max-w-full"/>}{file.kind==="AUDIO"&&file.mime.startsWith("audio/")&&<audio src={url} controls preload="metadata" className="mt-1 w-full"/>}</div>})}{message.reactions.length>0&&<div className="mt-2 flex flex-wrap gap-1">{message.reactions.map(r=><button key={r.emoji} type="button" disabled={!canAct} aria-pressed={r.mine} aria-label={`تفاعل ${r.emoji}، ${r.count}`} onClick={()=>onReact(message,r.emoji)} className={`min-h-8 rounded-full border px-2 text-sm ${r.mine?"border-accent bg-accent/10":"border-border"}`}>{r.emoji} {r.count}</button>)}</div>}</article>{canAct&&<MessageMenu context={context} onAction={id=>onAction(message,id)} onReact={emoji=>onReact(message,emoji)} sheetOpen={sheetOpen} onSheetOpenChange={setSheetOpen}/>}</div><ReaderRow readers={readers}/></div>
}
