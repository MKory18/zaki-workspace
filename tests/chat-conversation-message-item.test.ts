import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageItem } from "../src/components/chat/message/message-item";
import type { MessageDto } from "../src/server/chat/dto";
const base: MessageDto = { id:"m1", kind:"TEXT", body:"نص الرسالة", deleted:false, edited:false, pinned:false, mine:true, authorId:"u1", authorName:"ليلى", createdAt:"2026-01-01T00:00:00Z", mentions:[], attachments:[], reactions:[], replyTo:{id:"p1",preview:"رسالة سابقة",authorName:"سلمى"} };
describe("MessageItem", () => {
 it("renders reply context and accessible Arabic actions", () => { const html=renderToStaticMarkup(React.createElement(MessageItem,{message:base,canModerate:false,onReply(){},onReact(){},onPin(){},onEdit(){},onDelete(){}})); for(const text of ["رسالة سابقة","رد على الرسالة","تفاعل مع الرسالة","تثبيت الرسالة","تعديل الرسالة","حذف الرسالة"]) expect(html).toContain(text); });
 it("offers edit and delete actions to a moderator, but not an unrelated member", () => {
   const message = { ...base, mine: false };
   const render = (canModerate: boolean) => renderToStaticMarkup(React.createElement(MessageItem,{message,canModerate,onReply(){},onReact(){},onPin(){},onEdit(){},onDelete(){}}));
   const moderator = render(true);
   expect(moderator).toContain("تعديل الرسالة");
   expect(moderator).toContain("حذف الرسالة");
   const member = render(false);
   expect(member).not.toContain("تعديل الرسالة");
   expect(member).not.toContain("حذف الرسالة");
 });
 it("hides owner oversight actions and safely renders inline media with download links", () => { const message={...base,mine:false,attachments:[{id:"a1",kind:"IMAGE" as const,name:"صورة.png",mime:"image/png",size:10,url:"/api/chat/attachments/a1"},{id:"a2",kind:"VIDEO" as const,name:"clip.mp4",mime:"video/mp4",size:10,url:"/api/chat/attachments/a2"},{id:"a3",kind:"AUDIO" as const,name:"voice.ogg",mime:"audio/ogg",size:10,url:"/api/chat/attachments/a3"}]}; const html=renderToStaticMarkup(React.createElement(MessageItem,{message,canModerate:true,oversight:true,onReply(){},onReact(){},onPin(){},onEdit(){},onDelete(){}})); for(const text of ["رد على الرسالة","تثبيت الرسالة","تفاعل مع الرسالة"]) expect(html).not.toContain(text); for(const text of ["<img","<video","<audio","download"]) expect(html).toContain(text); });
});
