/**
 * Voice recording (FILES-VOICE): MediaRecorder wrapper that picks the first codec the
 * browser actually supports (`audio/webm;codecs=opus` first, `audio/mp4` for Safari,
 * `audio/ogg;codecs=opus` last), reports live level samples reduced to at most 100 waveform
 * peaks of 0..100, stops by itself after 5 minutes, and ALWAYS releases the microphone —
 * on stop, on cancel, and when the page is hidden mid-recording.
 */
export type RecorderError = "mic.denied" | "mic.unavailable" | "mic.unsupported" | "mic.busy";

export type VoiceRecorderOptions = {
  /** Live level samples, already reduced (never more than 100 values, 0..100). */
  onPeaks?: (peaks: number[]) => void;
  /** Elapsed recording time in ms, roughly every 100 ms. */
  onTick?: (elapsedMs: number) => void;
  /** The recording stopped by itself (5-minute cap or the page was hidden). */
  onAutoStop?: () => void;
};

export const MAX_RECORDING_MS = 5 * 60 * 1000;
const MAX_PEAKS = 100;

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private audioCtx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private peaks: number[] = [];
  private readonly opts: VoiceRecorderOptions;
  private readonly onHidden: () => void;

  constructor(opts: VoiceRecorderOptions = {}) {
    this.opts = opts;
    this.onHidden = () => {
      if (document.visibilityState === "hidden" && this.recorder) this.stop(); // never keep the mic open in the background
    };
  }

  get recording(): boolean {
    return this.recorder !== null;
  }

  get elapsedMs(): number {
    return this.recorder ? Date.now() - this.startedAt : 0;
  }

  async start(): Promise<void> {
    const mimeType = pickMimeType();
    if (!mimeType) throw error("mic.unsupported");
    if (!navigator.mediaDevices?.getUserMedia) throw error("mic.unsupported");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as DOMException)?.name;
      throw error(name === "NotFoundError" || name === "OverconstrainedError" ? "mic.unavailable" : "mic.denied");
    }
    this.stream = stream;
    this.peaks = [];
    const chunks: Blob[] = [];
    this.recorder = new MediaRecorder(stream, { mimeType });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    this.recorder.start(250);
    this.startedAt = Date.now();

    // live levels through an AnalyserNode, reduced to the waveform the message stores
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new Ctx();
      this.analyser = this.audioCtx.createAnalyser();
      this.audioCtx.createMediaStreamSource(stream).connect(this.analyser);
    } catch {
      this.analyser = null; // no levels: a flat waveform is drawn, recording still works
    }

    this.timer = setInterval(() => {
      if (this.analyser) {
        const buf = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (const v of buf) sum += v;
        const level = Math.min(100, Math.round((sum / buf.length / 255) * 100 * 3));
        this.peaks.push(level);
        if (this.peaks.length > MAX_PEAKS) this.downsample();
        this.opts.onPeaks?.([...this.peaks]);
      }
      this.opts.onTick?.(this.elapsedMs);
      if (this.elapsedMs >= MAX_RECORDING_MS) {
        this.stop();
        this.opts.onAutoStop?.();
      }
    }, 100);
    document.addEventListener("visibilitychange", this.onHidden);
  }

  /** Downsample in place: keep every other value so the array stays at or under 100. */
  private downsample(): void {
    const next: number[] = [];
    for (let i = 0; i < this.peaks.length; i += 2) next.push(this.peaks[i]!);
    this.peaks = next;
  }

  /** Stop and return the recording (or null when nothing was captured). */
  async stop(): Promise<{ blob: Blob; mime: string; durationMs: number; peaks: number[] } | null> {
    const recorder = this.recorder;
    if (!recorder) return null;
    const durationMs = Date.now() - this.startedAt;
    const chunks: Blob[] = [];
    const blob = await new Promise<Blob | null>((resolve) => {
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => resolve(chunks.length > 0 ? new Blob(chunks, { type: recorder.mimeType }) : null);
      if (recorder.state !== "inactive") recorder.stop();
      else resolve(null);
    });
    this.cleanup();
    if (!blob) return null;
    const mime = recorder.mimeType.split(";")[0] ?? "audio/webm";
    const peaks = normalisePeaks(this.peaks, MAX_PEAKS);
    return { blob, mime, durationMs, peaks };
  }

  /** Throw the take away: stop without returning anything. */
  cancel(): void {
    try {
      if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    } catch {
      // already gone
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener("visibilitychange", this.onHidden);
    this.stream?.getTracks().forEach((t) => t.stop()); // the microphone light goes off, always
    void this.audioCtx?.close().catch(() => undefined);
    this.recorder = null;
    this.stream = null;
    this.analyser = null;
    this.audioCtx = null;
  }
}

function error(key: RecorderError): Error {
  const e = new Error(key);
  e.name = key;
  return e;
}

/** Bring any sample count down to exactly at most `max` values, keeping the shape. */
export function normalisePeaks(peaks: number[], max = MAX_PEAKS): number[] {
  const clamped = peaks.map((p) => Math.max(0, Math.min(100, Math.round(p))));
  if (clamped.length <= max) return clamped;
  const out: number[] = [];
  const step = clamped.length / max;
  for (let i = 0; i < max; i++) out.push(clamped[Math.floor(i * step)] ?? 0);
  return out;
}
