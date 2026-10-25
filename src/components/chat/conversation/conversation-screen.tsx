"use client";
import React from "react";
import type { ConversationDto, MessageDto, ReaderDto } from "@/server/chat/dto";
import { conversationDetailUrl } from "@/lib/chat/conversation/client";
import { MessageItem } from "@/components/chat/message/message-item";
import { ChatComposer } from "@/components/chat/composer/chat-composer";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { announceChatRead } from "@/lib/chat/use-chat-unread";
import { Button } from "@/components/ui/button";
import { useOptionalToast } from "@/components/ui/toast";
import { ForwardDialog, NoteDialog } from "@/components/chat/message/message-dialogs";
import type { MessageMenuId } from "@/components/chat/message/message-menu-registry";
import { ct, ctCount } from "@/lib/chat/text";
import { TopicSettingsDialog } from "./topic-settings-dialog";
export interface ConversationScreenProps { conversationId: string; onBack: () => void; onOpenSettings?: () => void }
/**
 * What sits under the messages: the composer whenever the server says I may post (`me.canPost` already
 * covers closed, muted, guests and «للمشرفين فقط» — a space admin posts in the announcements), else the
 * owner's «شارك بالمحادثة», else the one line that says why not.
 */
export type ComposerBar = "composer" | "join" | "oversight" | "closed" | "muted" | "announcements" | "denied";
export function composerBarOf(me: ConversationDto["me"], conv: Pick<ConversationDto, "closed" | "topicType">): ComposerBar {
 if (me.canPost) return "composer";
 if (me.canJoin) return "join";
 if (me.oversight) return "oversight";
 if (conv.closed) return "closed";
 if (me.muted) return "muted";
 if (conv.topicType === "ANNOUNCEMENTS") return "announcements";
 return "denied";
}
/** The one reason line under the messages, from ar.chat-conversation.json (`chatc.bar.*`). */
const barText = (bar: Exclude<ComposerBar, "composer" | "join">): string => ct(`chatc.bar.${bar}`);
export function ConversationScreen({ conversationId, onBack, onOpenSettings }: ConversationScreenProps) {
 const [detail,setDetail]=React.useState<ConversationDto|null>(null); const [messages,setMessages]=React.useState<MessageDto[]>([]); const [reply,setReply]=React.useState<MessageDto|null>(null); const [editing,setEditing]=React.useState<MessageDto|null>(null); const [loading,setLoading]=React.useState(true); const [error,setError]=React.useState("");
 const lastMarked=React.useRef<string|null>(null);
 // `silent`: a live update (another person's message, an edit, a reaction) refetches without the loading line
 const refresh=React.useCallback(async(opts:{silent?:boolean}={})=>{if(!opts.silent)setLoading(true);setError("");try{const response=await fetch(conversationDetailUrl(conversationId),{cache:"no-store"});if(!response.ok)throw new Error(ct("chatc.load_failed"));const data=await response.json() as ConversationDto;setDetail(data);setMessages(data.messages);const last=data.messages.at(-1);/* mark read only for a message not marked yet: a read mark is itself a live event, and re-marking on it would loop */if(!data.me.oversight&&last&&lastMarked.current!==last.id){lastMarked.current=last.id;void fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/read?upTo=${encodeURIComponent(last.id)}`,{method:"POST"}).then(r=>{if(r.ok)announceChatRead();},()=>undefined);}}catch(e){setError(e instanceof Error?e.message:ct("chatc.failed"));}finally{setLoading(false);}},[conversationId]); React.useEffect(()=>{void refresh();},[refresh]);
 // Live: any event of THIS conversation (or a synthetic one with no conversation: the polling fallback,
 // a reconnect `reload`) refetches it quietly; a burst of events is folded into one refetch.
 const liveTimer=React.useRef<ReturnType<typeof setTimeout>|null>(null);
 React.useEffect(()=>()=>{if(liveTimer.current)clearTimeout(liveTimer.current);},[]);
 useRealtime((event)=>{if(event.conversationId&&event.conversationId!==conversationId)return;if(event.kind==="typing")return;if(liveTimer.current)clearTimeout(liveTimer.current);liveTimer.current=setTimeout(()=>{liveTimer.current=null;void refresh({silent:true});},250);});
 async function action(message:MessageDto,path:string,method="POST",body?:unknown){try{const response=await fetch(path,{method,headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});if(!response.ok)throw new Error(ct("chatc.action_failed"));if(method==="DELETE"){setMessages(current=>current.map(m=>m.id===message.id?{...m,deleted:true,body:null}:m));}else await refresh({silent:true});}catch(e){setError(e instanceof Error?e.message:ct("chatc.failed"));}}
 // «شارك بالمحادثة»: the owner leaves silent oversight for this topic; the composer appears and the join line reaches everybody live
 const [joining,setJoining]=React.useState(false);
 async function join(){setJoining(true);setError("");try{const response=await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/join`,{method:"POST"});if(!response.ok)throw new Error(ct("chatc.join_failed"));await refresh({silent:true});}catch(e){setError(e instanceof Error?e.message:ct("chatc.failed"));}finally{setJoining(false);}}
 // the ONE message menu: every action of every bubble arrives here
 const toast=useOptionalToast();
 const say=(key:string,kind:"success"|"error"="success")=>{const text=ct(key);if(toast)toast.toast(text,kind);else if(kind==="error")setError(text);};
 const [forwarding,setForwarding]=React.useState<MessageDto|null>(null);
 const [noting,setNoting]=React.useState<MessageDto|null>(null);
 function onAction(message:MessageDto,id:MessageMenuId){
  const at=`/api/chat/messages/${encodeURIComponent(message.id)}`;
  if(id==="reply"){setEditing(null);setReply(message);}
  else if(id==="pin")void action(message,`${at}/pin`);
  else if(id==="forward")setForwarding(message);
  else if(id==="edit"){setReply(null);setEditing(message);}
  else if(id==="note")setNoting(message);
  else if(id==="delete")void action(message,at,"DELETE");
  else if(id==="copy")void navigator.clipboard?.writeText(message.body??"").then(()=>say("chatc.menu.copied"),()=>say("chatc.menu.failed","error"));
 }
 // «إعدادات الموضوع»: its privacy (who sees and reads it, who writes) — for whoever moderates the topic
 const [settings,setSettings]=React.useState(false);
 const canSet=detail?.kind==="TOPIC"&&Boolean(detail?.me.canModerate);
 const oversight=Boolean(detail?.me.oversight);
 const bar=detail?composerBarOf(detail.me,detail):"composer";
 // each reader's avatar under the newest message they read (the server leaves out the viewer and the owner)
 const readersByMessage=React.useMemo(()=>{const map=new Map<string,ReaderDto[]>();for(const r of detail?.readers??[]){const list=map.get(r.messageId)??[];list.push(r);map.set(r.messageId,list);}return map;},[detail]);
 return <section dir="rtl" lang="ar" className="flex h-full min-h-0 flex-col" aria-label={ct("chatc.title_fallback")}><header className="flex items-center gap-3 border-b border-border p-3"><button type="button" onClick={onBack} className="min-h-11 md:hidden">{ct("chatc.back")}</button><div className="min-w-0 flex-1"><h1>{detail?.emoji?`${detail.emoji} `:""}{detail?.title??ct("chatc.title_fallback")}</h1><p className="text-sm text-fg-muted">{detail?.space?.name??(detail?.members?ctCount("chatc.members",detail.members.length):"")}</p></div>{canSet&&<button type="button" onClick={()=>setSettings(true)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 text-sm hover:bg-surface-2"><span aria-hidden="true">⚙</span>{ct("chatc.topic.settings")}</button>}{onOpenSettings&&<button type="button" aria-label={ct("chatc.settings")} onClick={onOpenSettings}>⋯</button>}</header>{detail&&canSet&&<TopicSettingsDialog open={settings} onOpenChange={setSettings} topic={detail} onSaved={()=>void refresh({silent:true})}/>}{oversight&&<p className="border-b border-border p-2 text-center">{ct("chatc.oversight_banner")}</p>}{detail?.space?.hasExternal&&<p className="p-2 text-sm">{ct("chatc.external")}</p>}
 <div role="log" aria-live="polite" aria-label={ct("chatc.log")} data-conversation-id={conversationId} className="min-h-0 flex-1 overflow-y-auto p-3">{loading&&<p role="status">{ct("chatc.loading")}</p>}{error&&<p role="alert">{error}</p>}{!loading&&!error&&!messages.length&&<p>{ct("chatc.empty")}</p>}{messages.map(message=><MessageItem key={message.id} message={message} readers={readersByMessage.get(message.id)} oversight={oversight} canModerate={Boolean(detail?.me.canModerate)} conversationKind={detail?.kind} canPost={Boolean(detail?.me.canPost)} onReact={(m,emoji)=>void action(m,`/api/chat/messages/${encodeURIComponent(m.id)}/react`,"POST",{emoji})} onAction={onAction}/>)}</div><ForwardDialog message={forwarding} from={conversationId} onClose={()=>setForwarding(null)} onDone={ok=>{setForwarding(null);say(ok?"chatc.menu.forwarded":"chatc.menu.failed",ok?"success":"error");}}/><NoteDialog message={noting} onClose={()=>setNoting(null)} onDone={ok=>{setNoting(null);say(ok?"chatc.menu.note_saved":"chatc.menu.failed",ok?"success":"error");if(ok)void refresh({silent:true});}}/>
 {detail&&bar!=="composer"?<footer className="border-t border-border p-3 text-center text-sm">{bar==="join"?<div className="flex flex-col items-center gap-1"><Button type="button" onClick={()=>void join()} disabled={joining} className="min-h-11 font-bold">{joining?ct("chatc.joining"):ct("chatc.join")}</Button><p className="text-xs text-fg-muted">{ct("chatc.join_hint")}</p></div>:barText(bar)}</footer>:<footer className="border-t border-border p-3">{detail&&<><ChatComposer conversationId={conversationId} detail={detail} reply={reply} onCancelReply={()=>setReply(null)} onMessage={message=>{setMessages(current=>[...current,message]);setReply(null);}} editing={editing} onCancelEdit={()=>setEditing(null)} onEdited={updated=>{setEditing(null);setMessages(current=>current.map(m=>m.id===updated.id?updated:m));}}/>{reply&&<div className="mt-2 flex items-center justify-between"><p>{ct("chatc.reply_to",{name:reply.authorName,body:reply.deleted?ct("chatc.deleted"):(reply.body??"")})}</p><button type="button" aria-label={ct("chatc.cancel_reply")} className="min-h-11 px-2" onClick={()=>setReply(null)}>{ct("chatc.cancel")}</button></div>}</>}</footer>}</section>;
}
