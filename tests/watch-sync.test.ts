import { describe, expect, it } from "vitest";
import { canPress, clockOffset, expectedPosition, followPlan, isNewer, isRemotePress, type RemoteState } from "@/lib/watch/sync";

const T0 = 1_800_000_000_000;
const playing = (positionSec: number, stateAt = T0, version = 1): RemoteState => ({ playing: true, positionSec, stateAt, version });
const paused = (positionSec: number, stateAt = T0, version = 1): RemoteState => ({ playing: false, positionSec, stateAt, version });

describe("«نتفرّج سوا»: where the others are now", () => {
  it("while it plays, the pressed second plus the time gone by since; paused, the pressed second", () => {
    expect(expectedPosition(playing(30), T0 + 12_500)).toBe(42.5);
    expect(expectedPosition(paused(30), T0 + 12_500)).toBe(30);
  });

  it("a late joiner computes the same second as everybody already watching", () => {
    const remote = playing(10);
    const tenMinutesLater = T0 + 600_000;
    expect(expectedPosition(remote, tenMinutesLater)).toBe(610);
  });

  it("a device clock behind the server's never puts the video before the pressed second", () => {
    expect(expectedPosition(playing(30), T0 - 5_000)).toBe(30);
  });

  it("the server's clock is read from one request, the answer taken half-way", () => {
    // sent at 1000, answered «2600», received at 1200: the server is 1500 ahead
    expect(clockOffset(1000, 2600, 1200)).toBe(1500);
    expect(clockOffset(1000, 900, 1200)).toBe(-200);
  });

  it("an older answer than the one held is dropped", () => {
    expect(isNewer(playing(5, T0, 3), null)).toBe(true);
    expect(isNewer(playing(5, T0, 4), playing(1, T0, 3))).toBe(true);
    expect(isNewer(playing(5, T0, 3), playing(1, T0, 3))).toBe(false);
    expect(isNewer(paused(5, T0, 2), playing(1, T0, 3))).toBe(false);
  });
});

describe("«نتفرّج سوا»: a screen that follows does the least it must", () => {
  it("the host paused: a playing screen pauses, and goes back to the paused second if it ran on", () => {
    expect(followPlan(paused(40), T0 + 1_000, { timeSec: 41.5, playing: true })).toEqual({ seekTo: 40, play: false, pause: true });
    expect(followPlan(paused(40), T0 + 1_000, { timeSec: 40.3, playing: true })).toEqual({ seekTo: null, play: false, pause: true });
  });

  it("the host played: a paused screen plays from where the others are", () => {
    expect(followPlan(playing(40), T0 + 4_000, { timeSec: 40, playing: false })).toEqual({ seekTo: 44, play: true, pause: false });
  });

  it("a screen a second off keeps playing; one more than two seconds off jumps to the others", () => {
    expect(followPlan(playing(40), T0 + 10_000, { timeSec: 49, playing: true })).toEqual({ seekTo: null, play: false, pause: false });
    expect(followPlan(playing(40), T0 + 10_000, { timeSec: 45, playing: true })).toEqual({ seekTo: 50, play: false, pause: false });
  });

  it("a screen already with the others does nothing", () => {
    expect(followPlan(paused(12), T0, { timeSec: 12, playing: false })).toEqual({ seekTo: null, play: false, pause: false });
  });
});

describe("«نتفرّج سوا»: the remote", () => {
  it("a play or a pause by whoever holds the remote is a press; a seek while playing too; normal playing is not", () => {
    expect(isRemotePress(playing(10), T0 + 5_000, { timeSec: 15, playing: false })).toBe(true);
    expect(isRemotePress(paused(10), T0, { timeSec: 10, playing: true })).toBe(true);
    expect(isRemotePress(playing(10), T0 + 5_000, { timeSec: 90, playing: true })).toBe(true);
    expect(isRemotePress(playing(10), T0 + 5_000, { timeSec: 15.4, playing: true })).toBe(false);
  });

  it("the host holds it; with «الكل بيتحكّم» everybody does; nobody once the session ended", () => {
    const session = { hostId: "host", everyoneControls: false, ended: false };
    expect(canPress(session, "host")).toBe(true);
    expect(canPress(session, "guest-of-session")).toBe(false);
    expect(canPress({ ...session, everyoneControls: true }, "guest-of-session")).toBe(true);
    expect(canPress({ ...session, ended: true }, "host")).toBe(false);
  });
});
