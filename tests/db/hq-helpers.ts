import { ensureHqSpace } from "@/server/chat/hq";
import { db } from "./helpers";

/**
 * «الشركة» (HQ) for a test company, with these people in it — as every real company has (created with the company,
 * src/server/chat/hq.ts). It is the first space of the people in it, so the pages read it unless they enter another;
 * the ideas and files from before spaces had their own are read there.
 */
export async function withHq(orgId: string, userIds: readonly string[]): Promise<string> {
  const hq = await ensureHqSpace(orgId, "الشركة");
  await db.workspaceMember.createMany({
    data: userIds.map((userId) => ({ workspaceId: hq, userId, role: "MEMBER" as const })),
    skipDuplicates: true,
  });
  return hq;
}
