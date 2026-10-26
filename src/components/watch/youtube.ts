"use client";

/**
 * The official YouTube player (IFrame Player API), loaded once per tab from YouTube itself: free, no key, and the
 * video streams from YouTube to each screen (nothing goes through our server). Only the few calls «نتفرّج سوا»
 * uses are typed here, so no package is added for them.
 */

export const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

export interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YtPlayerOptions {
  host?: string;
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (e: { target: YtPlayer }) => void;
    onStateChange?: (e: { data: number; target: YtPlayer }) => void;
    onError?: (e: { data: number }) => void;
  };
}

interface YtNamespace {
  Player: new (el: HTMLElement, options: YtPlayerOptions) => YtPlayer;
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = "https://www.youtube.com/iframe_api";
let loading: Promise<YtNamespace> | null = null;

/** The player API, loaded the first time it is asked for (a second page reuses it). */
export function loadYouTube(): Promise<YtNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YtNamespace>((resolve, reject) => {
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      before?.();
      if (window.YT?.Player) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = API_SRC;
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error("youtube api"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** A player in `el`, on the no-cookie host (YouTube keeps no cookie for the person until they play), inline on a phone. */
export async function createPlayer(
  el: HTMLElement,
  videoId: string,
  startSec: number,
  events: NonNullable<YtPlayerOptions["events"]>,
): Promise<YtPlayer> {
  const YT = await loadYouTube();
  return new YT.Player(el, {
    host: "https://www.youtube-nocookie.com",
    videoId,
    width: "100%",
    height: "100%",
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(startSec) },
    events,
  });
}
