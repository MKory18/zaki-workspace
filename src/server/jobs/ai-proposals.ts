import { expireStale } from "@/server/services/owner-assistant-proposals";

/**
 * «مساعد المالك»: a proposal the owner did not decide within 48 hours is marked EXPIRED. One conditional UPDATE (only rows still
 * PENDING and older than the limit), so two overlapping runs, or a read that expires the same row first, change nothing more.
 * It runs for every company whatever its switch says: expiring a stale proposal is housekeeping, and nothing else is touched.
 */
export interface AiProposalsRun {
  expired: number;
}

export async function expireAiProposals(now: Date): Promise<AiProposalsRun> {
  return { expired: await expireStale(now) };
}
