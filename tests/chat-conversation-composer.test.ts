import { describe, expect, it } from "vitest";
import { ChatComposer } from "../src/components/chat/composer/chat-composer";
import { buildChatMessagePayload, createChatUploadFormData, enterSends, isAtBottom, onNewest } from "../src/lib/chat/conversation/client";
import { findMentionQuery, insertMention, selectedMentionIds } from "../src/lib/chat/conversation/mentions";

describe("chat composer", () => {
  it("exports the attachment and member-mention composer", () => {
    expect(ChatComposer).toBeTypeOf("function");
  });

  it("detects an active @ query only at a word boundary", () => {
    expect(findMentionQuery("مرحبا @لي")).toEqual({ query: "لي", start: 6 });
    expect(findMentionQuery("name@example.com")).toBeNull();
  });

  it("replaces the @ query without deleting the separating space", () => {
    expect(insertMention("مرحبا @لي", "ليلى")).toBe("مرحبا @ليلى ");
    expect(insertMention("@لي", "ليلى")).toBe("@ليلى ");
  });

  it("includes only selected members whose full mention remains in the message", () => {
    const choices = [{ id: "member-1", name: "علي" }, { id: "member-2", name: "علي حسن" }];
    expect(selectedMentionIds("@علي مرحباً", choices)).toEqual(["member-1"]);
    expect(selectedMentionIds("مرحباً", choices)).toEqual([]);
  });

  it("uses the upload endpoint's multipart field names", () => {
    const file = new File(["file bytes"], "report.pdf", { type: "application/pdf" });
    const form = createChatUploadFormData(file, "FILE");
    expect(form.get("kind")).toBe("FILE");
    expect(form.get("file")).toBeInstanceOf(File);
    expect((form.get("file") as File).name).toBe("report.pdf");
  });

  it("builds the send payload with attachments, only selected mentions and optional reply", () => {
    expect(buildChatMessagePayload({
      body: "  مرحباً  ", attachmentIds: ["file-1"], mentions: ["member-1"], replyToId: "parent-1", clientId: "client-1",
    })).toEqual({
      body: "مرحباً", attachmentIds: ["file-1"], mentions: ["member-1"], replyToId: "parent-1", clientId: "client-1",
    });
  });

  it("Enter sends; Shift+Enter is a new line; nothing while an input method composes (the owner, 2026-10-26)", () => {
    expect(enterSends({ key: "Enter", shiftKey: false })).toBe(true);
    expect(enterSends({ key: "Enter", shiftKey: true })).toBe(false);
    expect(enterSends({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(enterSends({ key: "a", shiftKey: false })).toBe(false);
  });
});

describe("the view follows the newest message like a messaging app (the owner, 2026-10-26)", () => {
  it("down on opening, on one's own message, and when already at the bottom", () => {
    expect(onNewest({ opening: true, mine: false, atBottom: false, aroundHit: false })).toBe("bottom");
    expect(onNewest({ opening: false, mine: true, atBottom: false, aroundHit: false })).toBe("bottom");
    expect(onNewest({ opening: false, mine: false, atBottom: true, aroundHit: false })).toBe("bottom");
  });

  it("up reading older messages, someone else's message leaves the view where it is and is counted", () => {
    expect(onNewest({ opening: false, mine: false, atBottom: false, aroundHit: false })).toBe("badge");
  });

  it("around a search hit nothing moves", () => {
    expect(onNewest({ opening: true, mine: true, atBottom: true, aroundHit: true })).toBe("stay");
  });

  it("near the bottom counts as at the bottom", () => {
    expect(isAtBottom({ scrollTop: 900, scrollHeight: 1500, clientHeight: 560 })).toBe(true);
    expect(isAtBottom({ scrollTop: 200, scrollHeight: 1500, clientHeight: 560 })).toBe(false);
  });
});
