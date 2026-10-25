import { describe, expect, it } from "vitest";
import { isRealtimeKind, REALTIME_KINDS } from "@/server/realtime/emit";

describe("the realtime kinds are one list", () => {
  it("the whiteboard's event reaches the browsers as itself, not as conversation.changed", () => {
    // it used to be missing from the listener's own copy of the list, so every stroke arrived as a plain
    // `conversation.changed` and no other screen fetched the drawing
    expect(isRealtimeKind("whiteboard.changed")).toBe(true);
  });

  it("every kind of the list is known, and nothing else is", () => {
    for (const kind of REALTIME_KINDS) expect(isRealtimeKind(kind)).toBe(true);
    expect(isRealtimeKind("something.else")).toBe(false);
  });
});
