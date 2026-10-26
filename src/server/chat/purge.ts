import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { emitRealtime } from "@/server/realtime/emit";
import { assertFeatureOn } from "@/server/services/features";

/**
 * «حذف نهائي» — THE OWNER'S FULL DELETE OF A CONVERSATION (the owner's ask, 2026-10-26: «حذف كامل لاي مساحة او
 * موضوع دردشة او توبك بيد المالك فقط وحتى لو فيها محادثات»). A topic, a group or a DM goes with everything in it:
 * its messages, its members, its calls, its whiteboard and watch sessions (the database cascades), the files sent in
 * it (taken out of reach, like a deleted library file) and the bell's notifications that pointed at it.
 *
 * The OWNER only (partners included: they are owners). A space's two starter topics («عام», «التنبيهات») stay: the
 * space runs on them. Behind «قائمة المحادثة» in «الميزات» (`chatRowMenu`): off, this door is closed (404).
 */
export async function purgeConversation(ctx: OrgAccessContext, conversationId: string): Promise<void> {
  await assertFeatureOn(ctx.orgId, "chatRowMenu");
  if (ctx.orgRole !== "OWNER") throw new ForbiddenError("chat.e.owner_only");
  const conv = await db.conversation.findFirst({
    where: { id: conversationId, orgId: ctx.orgId },
    select: { id: true, spaceId: true, systemKey: true },
  });
  if (!conv) throw new NotFoundError("chat.e.not_found");
  if (conv.systemKey) throw new ForbiddenError("chat.topic_system");
  await db.$transaction(
    async (tx) => {
      // the files sent here: out of reach (their rows stay, like any deleted file, for the storage sweep)
      const files = await tx.messageAttachment.findMany({
        where: { message: { conversationId } },
        select: { fileId: true },
      });
      if (files.length) {
        await tx.storedFile.updateMany({
          where: { id: { in: files.map((f) => f.fileId) }, deletedAt: null },
          data: { deletedAt: new Date() },
        });
      }
      // the bell's notifications about it (a message, a mention, a call)
      await tx.notification.deleteMany({ where: { linkUrl: { contains: `/chat/${conversationId}` } } });
      await tx.conversation.delete({ where: { id: conversationId } });
      await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId, spaceId: conv.spaceId ?? undefined });
    },
    { timeout: 60_000 },
  );
}
