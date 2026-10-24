import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The recorder with a fake MediaRecorder: the whole take comes back (every 250 ms slice, not only
 * the last), and a take that stops by itself (5-minute cap, page hidden) is handed over, not lost.
 */

class FakeRecorder {
  static last: FakeRecorder | null = null;
  static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown, public opts: { mimeType: string }) {
    FakeRecorder.last = this;
  }
  get mimeType() {
    return this.opts.mimeType;
  }
  start() {
    this.state = "recording";
  }
  slice(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["END"]) }); // the final flush
    this.onstop?.();
  }
}

const track = { stop: vi.fn() };
beforeEach(() => {
  vi.useFakeTimers();
  FakeRecorder.last = null;
  track.stop.mockClear();
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) } });
  vi.stubGlobal("window", {}); // no AudioContext: a flat waveform, recording still works
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("VoiceRecorder", () => {
  it("returns the WHOLE recording: every slice plus the final flush, and frees the microphone", async () => {
    const { VoiceRecorder } = await import("@/lib/chat/voice-recorder");
    const rec = new VoiceRecorder();
    await rec.start();
    FakeRecorder.last!.slice("AAA");
    FakeRecorder.last!.slice("BBB");
    vi.advanceTimersByTime(1200);
    const take = await rec.stop();
    expect(take).not.toBeNull();
    expect(await take!.blob.text()).toBe("AAABBBEND");
    expect(take!.mime).toBe("audio/webm");
    expect(take!.durationMs).toBeGreaterThanOrEqual(1200);
    expect(track.stop).toHaveBeenCalled();
  });

  it("the 5-minute cap stops by itself and hands the take over instead of dropping it", async () => {
    const { VoiceRecorder, MAX_RECORDING_MS } = await import("@/lib/chat/voice-recorder");
    const onAutoStop = vi.fn();
    const rec = new VoiceRecorder({ onAutoStop });
    await rec.start();
    FakeRecorder.last!.slice("A");
    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS + 200);
    expect(onAutoStop).toHaveBeenCalledTimes(1);
    const take = onAutoStop.mock.calls[0]![0] as { blob: Blob; durationMs: number } | null;
    expect(take).not.toBeNull();
    expect(await take!.blob.text()).toBe("AEND");
    expect(take!.durationMs).toBeLessThanOrEqual(MAX_RECORDING_MS);
    expect(rec.recording).toBe(false);
  });

  it("cancel throws the take away and still frees the microphone", async () => {
    const { VoiceRecorder } = await import("@/lib/chat/voice-recorder");
    const rec = new VoiceRecorder();
    await rec.start();
    FakeRecorder.last!.slice("A");
    rec.cancel();
    expect(rec.recording).toBe(false);
    expect(track.stop).toHaveBeenCalled();
    expect(await rec.stop()).toBeNull();
  });
});
