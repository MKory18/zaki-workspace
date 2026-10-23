import type { ChatAttachmentKind } from "@/server/files/sniff";

/**
 * FILES-VOICE owns the implementation. The route layer (`/api/chat/uploads`) calls
 * `createChatUpload` in `@/server/chat/attachments` — everything needed to turn a multipart
 * request into a StoredFile row with purpose CHAT/VOICE lives there, next to `claimUploads`.
 */
export type { ChatUploadInput, ChatUploadResult, ChatAttachmentKind } from "@/server/chat/attachments";
