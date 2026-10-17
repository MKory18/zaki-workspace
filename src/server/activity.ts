// Structured activity helper — free functions used by services and API routes.
import { Prisma } from "@prisma/client";

/** Records a structured activity event (feeds, not parsed logs). */
export async function activity(
  tx: Prisma.TransactionClient,
  input: { taskId: string; actorId: string; event: string; meta?: Prisma.InputJsonValue },
): Promise<void> {
  await tx.taskActivity.create({
    data: {
      taskId: input.taskId,
      actorId: input.actorId,
      event: input.event,
      meta: input.meta ?? Prisma.JsonNull,
    },
  });
}
