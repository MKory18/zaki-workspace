import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CHAT_SOUND_URLS,
  MENTION_REPEAT_GAP_MS,
  playChatSound,
  setSoundsEnabled,
  soundOfArrival,
  soundsEnabled,
  SOUNDS_KEY,
} from "../src/lib/chat/sounds";
import { ConversationHeader } from "../src/components/chat/conversation/conversation-header";

(globalThis as { React?: typeof React }).React = React;
const ROOT = path.resolve(__dirname, "..");

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("which sound a new message makes (the owner, 2026-10-30: sounds for the chats)", () => {
  const base = { mine: false, opening: false, mentionsMe: false, kind: "TEXT" };

  it("somebody else's new message sounds «received»; one that mentions me sounds «mention»", () => {
    expect(soundOfArrival(base)).toBe("received");
    expect(soundOfArrival({ ...base, mentionsMe: true })).toBe("mention");
  });

  it("my own message makes no arrival sound (the send sound plays when I send)", () => {
    expect(soundOfArrival({ ...base, mine: true })).toBeNull();
  });

  it("opening a conversation is silent, and so is a system line", () => {
    expect(soundOfArrival({ ...base, opening: true })).toBeNull();
    expect(soundOfArrival({ ...base, kind: "SYSTEM" })).toBeNull();
  });
});

describe("the sounds switch", () => {
  it("is on until the person turns it off, and the choice is remembered", () => {
    const storage = memoryStorage();
    expect(soundsEnabled(storage)).toBe(true);
    setSoundsEnabled(false, storage);
    expect(storage.getItem(SOUNDS_KEY)).toBe("off");
    expect(soundsEnabled(storage)).toBe(false);
    setSoundsEnabled(true, storage);
    expect(soundsEnabled(storage)).toBe(true);
  });

  it("a browser with no storage (a private window) keeps the sounds on and never throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    };
    expect(soundsEnabled(broken)).toBe(true);
    expect(() => setSoundsEnabled(false, broken)).not.toThrow();
  });
});

describe("playing", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function fakeAudio() {
    const played: string[] = [];
    class FakeAudio {
      src: string;
      volume = 1;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        played.push(this.src);
        return Promise.resolve();
      }
    }
    vi.stubGlobal("Audio", FakeAudio);
    return played;
  }

  it("«sent» and «received» play their own file; «mention» plays «received» twice", () => {
    vi.useFakeTimers();
    const played = fakeAudio();
    playChatSound("sent", memoryStorage());
    playChatSound("received", memoryStorage());
    expect(played).toEqual([CHAT_SOUND_URLS.sent, CHAT_SOUND_URLS.received]);
    played.length = 0;
    playChatSound("mention", memoryStorage());
    vi.advanceTimersByTime(MENTION_REPEAT_GAP_MS + 5);
    expect(played).toEqual([CHAT_SOUND_URLS.received, CHAT_SOUND_URLS.received]);
  });

  it("plays nothing when the person turned the sounds off", () => {
    const played = fakeAudio();
    playChatSound("sent", memoryStorage({ [SOUNDS_KEY]: "off" }));
    expect(played).toEqual([]);
  });

  it("never throws when the browser refuses (no touch yet) or has no audio", async () => {
    class Refused {
      volume = 1;
      play() {
        return Promise.reject(new Error("NotAllowedError"));
      }
    }
    vi.stubGlobal("Audio", Refused);
    expect(() => playChatSound("sent", memoryStorage())).not.toThrow();
    await Promise.resolve();
    vi.stubGlobal("Audio", undefined);
    expect(() => playChatSound("sent", memoryStorage())).not.toThrow();
  });
});

describe("the files and where the screens use them", () => {
  it("are tiny mp3 files under public/sounds, credited as CC0 with their source", () => {
    for (const name of ["sent.mp3", "received.mp3"]) {
      const file = path.join(ROOT, "public/sounds", name);
      expect(statSync(file).size / 1024, name).toBeLessThanOrEqual(30);
    }
    const credits = readFileSync(path.join(ROOT, "public/brand/CREDITS.md"), "utf8");
    expect(credits).toMatch(/sounds\/sent\.mp3[^\n]*CC0[^\n]*opengameart\.org\/content\/pop-sounds/);
    expect(credits).toMatch(/sounds\/received\.mp3[^\n]*CC0[^\n]*opengameart\.org\/content\/pop-sounds/);
  });

  it("the composer plays «sent» after a message went, and the conversation plays the arrival sound", () => {
    const composer = readFileSync(path.join(ROOT, "src/components/chat/composer/chat-composer.tsx"), "utf8");
    const screen = readFileSync(path.join(ROOT, "src/components/chat/conversation/conversation-screen.tsx"), "utf8");
    expect(composer).toMatch(/playChatSound\("sent"\)/);
    expect(screen).toMatch(/soundOfArrival/);
    expect(screen).toMatch(/playChatSound\(arrival\)/);
  });

  it("the header carries a switch for the sounds, labelled for a screen reader", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConversationHeader, {
        conversationId: "c1",
        title: "عام",
        subtitle: "",
        call: null,
        searching: false,
        onSearch: () => undefined,
        canSet: false,
        onSettings: () => undefined,
        onBack: () => undefined,
      }),
    );
    expect(html).toContain("data-sound-toggle");
    expect(html).toContain('aria-pressed="true"');
  });
});
