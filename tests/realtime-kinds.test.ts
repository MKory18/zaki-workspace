import { describe, expect, it } from "vitest";
import { isRealtimeKind, REALTIME_KINDS } from "@/server/realtime/emit";

describe("the realtime kinds are one list", () => {
  it("a call's ring reaches the browser as itself, not as conversation.changed", () => {
    // they were missing from the listener's own copy of the list, so a ring arrived as a plain
    // `conversation.changed` and no phone rang
    expect(isRealtimeKind("call.ring")).toBe(true);
    expect(isRealtimeKind("call.changed")).toBe(true);
  });

  it("the whiteboard's event reaches the browsers as itself, not as conversation.changed", () => {
    // the same gap: every stroke arrived as a plain `conversation.changed` and no other screen fetched the drawing
    expect(isRealtimeKind("whiteboard.changed")).toBe(true);
  });

  it("every kind of the list is known, and nothing else is", () => {
    for (const kind of REALTIME_KINDS) expect(isRealtimeKind(kind)).toBe(true);
    expect(isRealtimeKind("something.else")).toBe(false);
  });
});
