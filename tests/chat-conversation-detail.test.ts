import { describe, expect, it } from "vitest";
import { conversationDetailUrl, messageClientId } from "../src/lib/chat/conversation/client";

describe("conversation detail client contract", () => {
  it("requests the newest forty messages from the exact detail endpoint", () => {
    expect(conversationDetailUrl("cv1")).toBe("/api/chat/conversations/cv1?limit=40");
  });
  it("generates a stable-format idempotency key for each send", () => {
    expect(messageClientId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
