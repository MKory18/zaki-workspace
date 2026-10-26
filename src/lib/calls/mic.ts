/**
 * The microphone while the person steps out of the app on a phone (src/components/calls/call-provider.tsx).
 * A phone's browser stops or silences the microphone of a page in the background (an iPhone always; Android at times):
 * the call goes on, but the others hear nothing. These rules tell when the microphone is held by the phone rather than
 * by the person, so it is started again as soon as they are back — never left silently off — and the others are told
 * why the person is quiet meanwhile. Pure, so the rules are tested without a phone.
 */

export interface MicFacts {
  /** the microphone is published in the call */
  published: boolean;
  /** muted by a choice: the person's own button, or a host's «اكتم» (the phone's silence is not a choice) */
  chosenMute: boolean;
  /** the capture's own state: "ended" once the phone took the microphone away */
  readyState: "live" | "ended";
  /** the capture is live but silenced by the phone (the track's muted flag) */
  silenced: boolean;
  /** the call stopped sending the microphone, after a silence that lasted */
  upstreamPaused: boolean;
}

/** The microphone should be heard but is not: the phone holds it. */
export function micHeld(f: MicFacts): boolean {
  if (!f.published || f.chosenMute) return false;
  return f.readyState !== "live" || f.silenced || f.upstreamPaused;
}

/** The message the others get when the person steps out of the app or comes back (data channel, this topic). */
export const AWAY_TOPIC = "zk-away";

export function encodeAway(away: boolean): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ away }));
}

/** The flag inside such a message, or null for anything else (a malformed or foreign message is ignored). */
export function decodeAway(bytes: Uint8Array): boolean | null {
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes)) as { away?: unknown };
    return typeof v?.away === "boolean" ? v.away : null;
  } catch {
    return null;
  }
}
