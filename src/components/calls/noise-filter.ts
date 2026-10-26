"use client";

import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import type { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";

/**
 * «تنقية صوت المكالمات» — the microphone cleaned of the noise around the person (an air conditioner, the street, a
 * keyboard, children) before it leaves their device, by RNNoise (BSD, run as WebAssembly in an audio worklet, through
 * @sapphi-red/web-noise-suppressor, MIT). Nothing is sent anywhere: the model and its worklet are served by this app
 * (public/noise/, copied by scripts/copy-noise-assets.mjs) and run in the person's browser.
 *
 * It sits on the call's microphone track as the calls library's audio processor, so a restarted microphone (back
 * from another app) is filtered again by itself. The browser's own echo cancelling, noise suppression and gain stay as
 * they were: the filter only adds. Anything that fails (an old browser, no WebAssembly) leaves the voice as before.
 */

const BASE = "/noise";

/** RNNoise works on 48 kHz audio: its own audio graph runs at that rate whatever the microphone's. */
const SAMPLE_RATE = 48_000;

let binary: Promise<ArrayBuffer> | null = null;

/** The model, fetched once per page (the SIMD build where the browser has SIMD). */
function model(): Promise<ArrayBuffer> {
  binary ??= loadRnnoise({ url: `${BASE}/rnnoise.wasm`, simdUrl: `${BASE}/rnnoise_simd.wasm` }).catch((e: unknown) => {
    binary = null; // a failed fetch is tried again by the next call
    throw e;
  });
  return binary;
}

/** Can this browser run the filter at all? */
export function canFilterNoise(): boolean {
  return typeof window !== "undefined" && typeof AudioWorkletNode !== "undefined" && typeof WebAssembly === "object" && typeof AudioContext !== "undefined";
}

export const NOISE_FILTER_NAME = "zk-rnnoise";

/**
 * The filter, and the capture it cleans: the calls library hands out the filter's output as the track's
 * `mediaStreamTrack`, which stays «live» (silent) when the phone takes the microphone away, so whoever needs to know
 * whether the microphone itself still works reads `sourceTrack` (src/components/calls/call-provider.tsx).
 */
export type NoiseFilter = TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> & { sourceTrack?: MediaStreamTrack };

/** A fresh filter for one microphone track. */
export function noiseFilter(): NoiseFilter {
  let graph: { ctx: AudioContext; source: MediaStreamAudioSourceNode; node: RnnoiseWorkletNode; out: MediaStreamAudioDestinationNode } | null = null;

  const processor: NoiseFilter = {
    name: NOISE_FILTER_NAME,
    processedTrack: undefined,
    sourceTrack: undefined,
    async init(opts) {
      await build(opts.track);
    },
    async restart(opts) {
      await teardown();
      await build(opts.track);
    },
    async destroy() {
      await teardown();
    },
  };

  async function build(track: MediaStreamTrack): Promise<void> {
    const wasmBinary = await model();
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    try {
      await ctx.audioWorklet.addModule(`${BASE}/rnnoise-worklet.js`);
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const node = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
      const out = ctx.createMediaStreamDestination();
      source.connect(node).connect(out);
      // a phone starts an audio graph suspended; the call was joined with a tap, so it may run
      if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
      graph = { ctx, source, node, out };
      processor.sourceTrack = track;
      processor.processedTrack = out.stream.getAudioTracks()[0];
    } catch (e) {
      await ctx.close().catch(() => undefined);
      throw e;
    }
  }

  async function teardown(): Promise<void> {
    const g = graph;
    graph = null;
    processor.processedTrack = undefined;
    processor.sourceTrack = undefined;
    if (!g) return;
    g.source.disconnect();
    g.node.disconnect();
    g.node.destroy();
    for (const t of g.out.stream.getTracks()) t.stop();
    await g.ctx.close().catch(() => undefined);
  }

  return processor;
}
