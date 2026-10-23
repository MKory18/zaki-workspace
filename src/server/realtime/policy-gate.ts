/**
 * The thin, typed seam between REALTIME and the policy module.
 *
 * `src/server/policy/conversation.ts` is owned by the SERVICES agent and may not
 * exist yet while both waves are in flight. REALTIME imports its contract
 * functions THROUGH this module; the indirection also lets unit tests stub the
 * answers (a logic test of the hub proves the fan-out, not the rule — the rule
 * itself is proven by SERVICES' DB tests against `policy/conversation.ts`).
 *
 * When policy/conversation.ts lands, only this file changes (the delegation
 * switch); every consumer keeps importing from here.
 */

export interface RealtimePolicy {
  canReadConversation(userId: string, conversationId: string): Promise<boolean>;
}

type Stubs = Partial<RealtimePolicy>;

let stubs: Stubs = {};

/** Test hook: stub one or both contract functions (never call from server code). */
export function setPolicyStubs(next: Stubs): void {
  stubs = next;
}

export async function canReadConversation(userId: string, conversationId: string): Promise<boolean> {
  const stub = stubs.canReadConversation;
  if (stub) return stub(userId, conversationId);
  // Delegation to the real policy module is loaded lazily: the module may not
  // exist yet (SERVICES lands it in the same wave). A missing module surfaces
  // as a clear error, caught by the hub as "not visible" so nothing leaks.
  const mod = (await import("@/server/policy/conversation")) as unknown as Record<
    string,
    ((a: string, b: string) => Promise<boolean>) | undefined
  >;
  const real = mod.canReadConversation;
  if (typeof real !== "function") {
    throw new Error("not implemented: policy/canReadConversation (SERVICES)");
  }
  return real(userId, conversationId);
}
