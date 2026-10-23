import { describe, expect, it } from "vitest";
import { barsFor, formatDuration, toPeaks } from "../src/lib/chat/waveform";

describe("waveform peaks (deliverable 5)", () => {
  it("clamps samples into 0..100 integers", () => {
    expect(toPeaks([-5, 0.4, 50.6, 120])).toEqual([0, 0, 51, 100]);
  });

  it("keeps short samples as they are", () => {
    expect(toPeaks([10, 20, 30])).toEqual([10, 20, 30]);
  });

  it("downsamples to at most 100 keeping the shape", () => {
    const samples = Array.from({ length: 400 }, (_, i) => (i % 100) + 1);
    const peaks = toPeaks(samples, 100);
    expect(peaks.length).toBe(100);
    expect(peaks[0]).toBeLessThan(peaks[99]!);
  });

  it("barsFor stretches up and averages down", () => {
    expect(barsFor([10, 50], 4).length).toBe(4);
    const wide = barsFor([10, 90, 10, 90], 2);
    expect(wide[0]).toBe(50); // average of [10,90]
    expect(wide[1]).toBe(50);
    expect(barsFor([], 8)).toEqual(new Array(8).fill(0));
    expect(barsFor([1, 2, 3], 0)).toEqual([]);
  });

  it("formatDuration is mm:ss (h:mm:ss over an hour)", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_600_000)).toBe("1:00:00");
  });
});
