/**
 * «نتفرّج سوا» — KEEPING EVERY SCREEN ON THE SAME SECOND.
 *
 * Pure (no React, no player, no server): the session page runs these against the YouTube player, the tests run them
 * against numbers. The server keeps one remote per session: playing or paused, from which second, as of which moment
 * of the SERVER's clock. Every screen works out from that where the others are now, so a late joiner lands on the
 * same second and a slow connection catches up by itself. Light on purpose: only these few numbers travel, the video
 * itself comes from its own site.
 */

export interface RemoteState {
  playing: boolean;
  positionSec: number;
  /** when the remote was last pressed, in milliseconds of the server's clock */
  stateAt: number;
  /** goes up by one on every press: an answer older than the one a screen has is dropped */
  version: number;
}

/** A screen this far from the others jumps to them (smaller differences are not worth a jump). */
export const DRIFT_SEEK_SEC = 2;
/** A paused screen this far from the paused second is put back on it. */
export const PAUSED_SEEK_SEC = 0.75;
/** How often a screen that follows checks itself against the others. */
export const DRIFT_CHECK_MS = 3_000;

/** Where the others are now: the pressed second, plus the time gone by since, while it plays. */
export function expectedPosition(state: RemoteState, serverNowMs: number): number {
  if (!state.playing) return state.positionSec;
  return Math.max(0, state.positionSec + Math.max(0, serverNowMs - state.stateAt) / 1000);
}

/**
 * How far the server's clock is ahead of this device's, from one request: sent at `sentAt`, answered with the
 * server's `serverNow`, received at `receivedAt` (the answer is taken to have been written half-way).
 */
export function clockOffset(sentAt: number, serverNow: number, receivedAt: number): number {
  return serverNow - (sentAt + receivedAt) / 2;
}

/** Is `incoming` newer than what the screen holds (null: nothing yet)? */
export function isNewer(incoming: RemoteState, held: RemoteState | null): boolean {
  return !held || incoming.version > held.version;
}

/** What the player of a screen that follows should do to be with the others. */
export interface FollowPlan {
  seekTo: number | null;
  play: boolean;
  pause: boolean;
}

/**
 * A screen that follows (not holding the remote, not stepped away): from the remote and what its own player is
 * doing, the least it must do — jump only when it is really off, play or pause only when it is not already.
 */
export function followPlan(state: RemoteState, serverNowMs: number, player: { timeSec: number; playing: boolean }): FollowPlan {
  const target = expectedPosition(state, serverNowMs);
  const off = Math.abs(player.timeSec - target);
  const seekTo = off > (state.playing ? DRIFT_SEEK_SEC : PAUSED_SEEK_SEC) ? target : null;
  return { seekTo, play: state.playing && !player.playing, pause: !state.playing && player.playing };
}

/**
 * The person holding the remote moved their own player: is it a press the others must follow? A play or a pause
 * always is; while playing, a jump of more than the drift is a seek (YouTube tells no «seeked»).
 */
export function isRemotePress(state: RemoteState, serverNowMs: number, player: { timeSec: number; playing: boolean }): boolean {
  if (player.playing !== state.playing) return true;
  return Math.abs(player.timeSec - expectedPosition(state, serverNowMs)) > DRIFT_SEEK_SEC;
}

/** May this person press the remote? The host, or anybody of the session when «الكل بيتحكّم» is on; never once it ended. */
export function canPress(session: { hostId: string; everyoneControls: boolean; ended: boolean }, viewerId: string): boolean {
  if (session.ended) return false;
  return session.everyoneControls || session.hostId === viewerId;
}
