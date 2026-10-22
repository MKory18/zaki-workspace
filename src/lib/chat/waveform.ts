/**
 * Waveform helpers (FILES-VOICE): the peaks stored with a voice message (up to 100 integers
 * 0..100) are drawn as bars. Pure functions so the UI and the tests share one definition.
 */

/** Normalise arbitrary level samples into at most `max` integers of 0..100, keeping the shape. */
export function toPeaks(samples: number[], max = 100): number[] {
  const clamped = samples.map((p) => (Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : 0));
  if (clamped.length <= max) return clamped;
  const out: number[] = [];
  const step = clamped.length / max;
  for (let i = 0; i < max; i++) out.push(clamped[Math.floor(i * step)] ?? 0);
  return out;
}

/** Peaks a player draws: exactly `bars` values (stretch or shrink, never lose the shape). */
export function barsFor(peaks: number[], bars: number): number[] {
  if (bars <= 0) return [];
  if (peaks.length === 0) return new Array(bars).fill(0);
  if (peaks.length === bars) return peaks;
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    if (peaks.length < bars) {
      // stretch: nearest neighbour
      out.push(peaks[Math.floor((i * peaks.length) / bars)] ?? 0);
    } else {
      // shrink: average the window
      const start = Math.floor((i * peaks.length) / bars);
      const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / bars));
      let sum = 0;
      for (let j = start; j < end; j++) sum += peaks[j] ?? 0;
      out.push(Math.round(sum / (end - start)));
    }
  }
  return out;
}

/** A duration in mm:ss (over an hour: h:mm:ss) for the voice player. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
