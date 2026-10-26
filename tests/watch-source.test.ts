import { describe, expect, it } from "vitest";
import { parseStart, parseWatchLink, watchEmbedUrl, watchPageUrl } from "@/lib/watch/source";

const ID = "dQw4w9WgXcQ";

describe("«نتفرّج سوا»: which links play", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&list=PL123&index=2`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abcdef`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `youtu.be/${ID}`,
    `  www.youtube.com/watch?v=${ID}  `,
    `http://www.youtube.com/watch?v=${ID}`,
  ])("a YouTube link plays: %s", (link) => {
    expect(parseWatchLink(link)).toEqual({ kind: "YOUTUBE", ref: ID, startSec: 0 });
  });

  it.each([
    "",
    "hello",
    `https://www.youtube.com/watch?v=short`,
    `https://www.youtube.com/watch?v=${ID}x`,
    `https://www.youtube.com/channel/UC1234567890`,
    `https://www.youtube.com/`,
    `https://evil.example/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    `javascript:alert(1)//youtu.be/${ID}`,
    `ftp://youtu.be/${ID}`,
    `https://youtu.be/${ID}`.padEnd(2100, "x"),
  ])("anything else does not: %s", (link) => {
    expect(parseWatchLink(link)).toBeNull();
  });

  it("keeps where the link asked to start", () => {
    expect(parseWatchLink(`https://youtu.be/${ID}?t=90`)?.startSec).toBe(90);
    expect(parseWatchLink(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)?.startSec).toBe(90);
    expect(parseWatchLink(`https://www.youtube.com/embed/${ID}?start=42`)?.startSec).toBe(42);
  });

  it("reads a start time written as hours, minutes and seconds", () => {
    expect(parseStart("1h2m3s")).toBe(3723);
    expect(parseStart("45s")).toBe(45);
    expect(parseStart("2m")).toBe(120);
    expect(parseStart("abc")).toBe(0);
    expect(parseStart("")).toBe(0);
    expect(parseStart(null)).toBe(0);
  });

  it("plays through the no-cookie player, inline on a phone, from the start asked", () => {
    const url = new URL(watchEmbedUrl({ kind: "YOUTUBE", ref: ID }, 90.7));
    expect(url.origin).toBe("https://www.youtube-nocookie.com");
    expect(url.pathname).toBe(`/embed/${ID}`);
    expect(url.searchParams.get("playsinline")).toBe("1");
    expect(url.searchParams.get("start")).toBe("90");
    expect(new URL(watchEmbedUrl({ kind: "YOUTUBE", ref: ID })).searchParams.has("start")).toBe(false);
    expect(watchPageUrl({ kind: "YOUTUBE", ref: ID })).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});
