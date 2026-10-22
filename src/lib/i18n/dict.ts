import base from "./ar.json";
import accounts from "./ar.accounts.json";
import policy from "./ar.policy.json";
import onboarding from "./ar.onboarding.json";
import members from "./ar.members.json";

/**
 * The Arabic dictionary: `ar.json` plus one fragment per feature (accounts, policy, onboarding,
 * members, ...). Fragments exist so that several people can add strings at the same time without
 * editing the same 700-line file; a later fragment wins on a duplicate key (tests/encoding-hygiene
 * fails on duplicates across files, so none are expected).
 */
export const AR: Record<string, string> = { ...base, ...accounts, ...policy, ...onboarding, ...members };
