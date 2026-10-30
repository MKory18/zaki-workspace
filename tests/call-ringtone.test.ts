import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RING_GAP_MS, RING_SOUND_URL, ringbackMsLeft, startRing } from "../src/lib/calls/ring-sound";

const ROOT = path.resolve(__dirname, "..");

describe("the caller hears the phone ring while nobody has answered (the owner, 2026-10-30: like a messenger)", () => {
  const startedAt = "2026-10-30T12:00:00Z";
  const at = (sec: number) => Date.parse(startedAt) + sec * 1000;

  it("rings while the caller is alone in a call that just started, for the same 30 s the other side rings", () => {
    expect(ringbackMsLeft({ alone: true, startedAt, now: at(5), forMs: 30_000 })).toBe(25_000);
    expect(ringbackMsLeft({ alone: true, startedAt, now: at(0), forMs: 30_000 })).toBe(30_000);
  });

  it("stops as soon as somebody else is in, and does not ring in an old call", () => {
    expect(ringbackMsLeft({ alone: false, startedAt, now: at(5), forMs: 30_000 })).toBe(0);
    expect(ringbackMsLeft({ alone: true, startedAt, now: at(31), forMs: 30_000 })).toBe(0);
  });
});

describe("the ring sound", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("plays the file, asks again after a short pause, and stops cleanly", () => {
    vi.useFakeTimers();
    const instances: FakeAudio[] = [];
    class FakeAudio {
      src: string;
      volume = 1;
      onended: (() => void) | null = null;
      play = vi.fn(() => Promise.resolve());
      pause = vi.fn();
      constructor(src: string) {
        this.src = src;
        instances.push(this);
      }
    }
    vi.stubGlobal("Audio", FakeAudio);
    const stop = startRing();
    expect(instances[0]?.src).toBe(RING_SOUND_URL);
    expect(instances[0]?.play).toHaveBeenCalledTimes(1);
    instances[0]?.onended?.();
    vi.advanceTimersByTime(RING_GAP_MS + 10);
    expect(instances[0]?.play).toHaveBeenCalledTimes(2);
    stop();
    expect(instances[0]?.pause).toHaveBeenCalled();
    vi.advanceTimersByTime(RING_GAP_MS * 3);
    expect(instances[0]?.play).toHaveBeenCalledTimes(2); // nothing plays after stop
    stop(); // a second stop is harmless
  });

  it("never throws when the browser refuses to play (no gesture yet): the built-in beep takes over", async () => {
    class RefusedAudio {
      volume = 1;
      onended: (() => void) | null = null;
      play = () => Promise.reject(new Error("NotAllowedError"));
      pause = () => undefined;
    }
    vi.stubGlobal("Audio", RefusedAudio);
    const stop = startRing();
    await Promise.resolve();
    expect(() => stop()).not.toThrow();
  });
});

describe("the sound file and who owns it", () => {
  it("is a small mp3 under public/sounds, and the credits say where it came from and under which licence", () => {
    const file = path.join(ROOT, "public/sounds/ring.mp3");
    expect(statSync(file).size / 1024).toBeLessThanOrEqual(150);
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 3).toString("latin1") === "ID3" || bytes[0] === 0xff).toBe(true);
    const credits = readFileSync(path.join(ROOT, "public/brand/CREDITS.md"), "utf8");
    expect(credits).toMatch(/sounds\/ring\.mp3[^\n]*CC0[^\n]*opengameart\.org\/content\/modern-ringtone-chirptone/);
  });

  it("is served like the other static folders: a request for it is never sent to the sign-in page", () => {
    const middleware = readFileSync(path.join(ROOT, "src/middleware.ts"), "utf8");
    expect(middleware).toMatch(/STATIC_DIRS = \[[^\]]*"\/sounds\/"/);
    expect(middleware).toMatch(/STATIC_EXT = [^
]*mp3/);
  });

  it("is used by both sides: the incoming card and the caller's room", () => {
    const card = readFileSync(path.join(ROOT, "src/components/calls/call-ring.tsx"), "utf8");
    const room = readFileSync(path.join(ROOT, "src/components/calls/call-room.tsx"), "utf8");
    expect(card).toMatch(/startRing/);
    expect(card).not.toMatch(/createOscillator/);
    expect(room).toMatch(/startRing/);
    expect(room).toMatch(/ringbackMsLeft/);
  });
});
