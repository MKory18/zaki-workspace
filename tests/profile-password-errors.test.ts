import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api-client";
import { AR } from "../src/lib/i18n/dict";
import { passwordErrorText } from "../src/components/profile-form";

const t = (key: string) => AR[key] ?? key;

describe("profile: why a password change failed", () => {
  it("a wrong current password says so (the server sends code 'forbidden' and the reason in the message key)", () => {
    const err = new ApiError("forbidden", 403, undefined, "password.wrong_current");
    expect(passwordErrorText(err, t)).toBe(AR["profile.wrongCurrent"]);
  });

  it("too many tries says to wait", () => {
    const err = new ApiError("rate_limited", 429, undefined, "rate_limited");
    expect(passwordErrorText(err, t)).toBe(AR["auth.too_many_attempts"]);
  });

  it("a new password equal to the old one shows the rule it breaks", () => {
    const err = new ApiError("validation.failed", 422, [{ path: "newPassword", message: "onboarding.err_same" }], "validation.failed");
    expect(passwordErrorText(err, t)).toBe(AR["onboarding.err_same"]);
  });

  it("anything it cannot explain is the generic error, never a raw key", () => {
    expect(passwordErrorText(new ApiError("internal", 500), t)).toBe(AR["common.error"]);
    expect(passwordErrorText(new Error("network"), t)).toBe(AR["common.error"]);
    const unknownRule = new ApiError("validation.failed", 422, [{ path: "x", message: "no.such.key" }]);
    expect(passwordErrorText(unknownRule, t)).toBe(AR["common.error"]);
  });
});
