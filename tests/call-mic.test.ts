import { describe, expect, it } from "vitest";
import { AWAY_TOPIC, decodeAway, encodeAway, micHeld, type MicFacts } from "@/lib/calls/mic";

const live: MicFacts = { published: true, chosenMute: false, readyState: "live", silenced: false, upstreamPaused: false };

describe("the microphone after stepping out of the app on a phone", () => {
  it("a microphone that works is not held", () => {
    expect(micHeld(live)).toBe(false);
  });

  it("the phone took it away, silenced it, or the call stopped sending it: held, so it is started again on the way back", () => {
    expect(micHeld({ ...live, readyState: "ended" })).toBe(true); // an iPhone after some time in the background
    expect(micHeld({ ...live, silenced: true })).toBe(true); // silenced by the system while away
    expect(micHeld({ ...live, upstreamPaused: true })).toBe(true); // the silence lasted, the call paused sending it
  });

  it("a choice is never undone: the person's own mute or a host's «اكتم» stays muted", () => {
    expect(micHeld({ ...live, chosenMute: true, readyState: "ended" })).toBe(false);
    expect(micHeld({ ...live, chosenMute: true, silenced: true, upstreamPaused: true })).toBe(false);
  });

  it("no microphone in the call (no permission, no device): nothing to start again", () => {
    expect(micHeld({ ...live, published: false, readyState: "ended" })).toBe(false);
  });

  it("the others are told when the person steps out and comes back; anything else on the channel is ignored", () => {
    expect(AWAY_TOPIC).toBe("zk-away");
    expect(decodeAway(encodeAway(true))).toBe(true);
    expect(decodeAway(encodeAway(false))).toBe(false);
    expect(decodeAway(new TextEncoder().encode("hello"))).toBeNull();
    expect(decodeAway(new TextEncoder().encode(JSON.stringify({ away: "yes" })))).toBeNull();
  });
});
