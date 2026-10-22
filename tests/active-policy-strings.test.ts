import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";

/**
 * Errors travel as machine keys and the screen shows `t(key)`; a key without Arabic text would put
 * the raw key in front of the owner. These are the refusals the "suspended or removed people do not
 * count" and "capabilities switch things" rules added or started to raise in the services.
 */
describe("the Arabic text behind the new refusals", () => {
  const keys = [
    "assignee.not_active", // work handed to somebody suspended or offboarded
    "not_org_member", // not an ACTIVE member of the organization (any more)
    "insufficient_role", // a capability the owner switched off (crm.edit, directory.view, ...)
    "assignee.not_member", // work handed to somebody outside the organization
  ];

  it.each(keys)("%s has an Arabic text", (key) => {
    expect(AR[key], key).toBeTruthy();
    expect(AR[key], key).toMatch(/[؀-ۿ]/);
    expect(AR[key], key).not.toBe(key);
  });
});
