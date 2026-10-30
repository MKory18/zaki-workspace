import { describe, expect, it } from "vitest";
import {
  filterMentionChoices,
  isMentioned,
  MENTION_ALL_ID,
  MENTION_ALL_NAME,
  mentionsAll,
  splitMentions,
} from "../src/lib/chat/conversation/mentions";

describe("«@الكل»: one word that reaches everybody in the topic", () => {
  it("is found only as a whole word, at the start or after a space", () => {
    expect(mentionsAll(`@${MENTION_ALL_NAME} الاجتماع بعد قليل`)).toBe(true);
    expect(mentionsAll(`مرحبا @${MENTION_ALL_NAME}`)).toBe(true);
    expect(mentionsAll(`مرحبا @${MENTION_ALL_NAME}،`)).toBe(true);
    expect(mentionsAll(`@${MENTION_ALL_NAME}ين`)).toBe(false);
    expect(mentionsAll(`mail@${MENTION_ALL_NAME}`)).toBe(false);
    expect(mentionsAll("مرحبا بالجميع")).toBe(false);
  });

  it("counts as «mentioned» for everybody, next to the people named one by one", () => {
    expect(isMentioned(["u1", "u2"], "u2")).toBe(true);
    expect(isMentioned(["u1"], "u2")).toBe(false);
    expect(isMentioned([MENTION_ALL_ID], "anyone")).toBe(true);
    expect(isMentioned([], "anyone")).toBe(false);
  });
});

describe("the mention list while typing", () => {
  const people = [
    { id: "1", name: "أحمد", online: false },
    { id: "2", name: "محمد نضال", online: true },
    { id: "3", name: "آية", online: false },
    { id: "4", name: "مها", online: true },
  ];

  it("keeps those whose name STARTS with the typed letters first, then those that contain them", () => {
    expect(filterMentionChoices(people, "م").map((p) => p.id)).toEqual(["2", "4", "1"]);
    expect(filterMentionChoices(people, "نضال").map((p) => p.id)).toEqual(["2"]);
  });

  it("does not care about hamza, ta marbuta or marks (آية is found by «اي»)", () => {
    expect(filterMentionChoices(people, "اي").map((p) => p.id)).toEqual(["3"]);
    expect(filterMentionChoices(people, "احمد").map((p) => p.id)).toEqual(["1"]);
  });

  it("with nothing typed yet offers everybody, those online first", () => {
    expect(filterMentionChoices(people, "").map((p) => p.id)).toEqual(["2", "4", "1", "3"]);
  });
});

describe("a message shows its mentions as highlighted words", () => {
  it("splits the body into plain text and mention pieces, the longest name first", () => {
    const pieces = splitMentions("أهلا @محمد نضال و@محمد", ["محمد", "محمد نضال", MENTION_ALL_NAME]);
    expect(pieces).toEqual([
      { text: "أهلا ", mention: false },
      { text: "@محمد نضال", mention: true },
      { text: " و@محمد", mention: false },
    ]);
  });

  it("only a mention that stands as a word is highlighted", () => {
    expect(splitMentions("a@محمد", ["محمد"])).toEqual([{ text: "a@محمد", mention: false }]);
    expect(splitMentions("@محمد.", ["محمد"])).toEqual([
      { text: "@محمد", mention: true },
      { text: ".", mention: false },
    ]);
  });

  it("highlights «@الكل» too and returns plain text untouched", () => {
    expect(splitMentions(`@${MENTION_ALL_NAME} انتبهوا`, [MENTION_ALL_NAME])).toEqual([
      { text: `@${MENTION_ALL_NAME}`, mention: true },
      { text: " انتبهوا", mention: false },
    ]);
    expect(splitMentions("كلام عادي", ["محمد"])).toEqual([{ text: "كلام عادي", mention: false }]);
    expect(splitMentions("", ["محمد"])).toEqual([]);
  });
});
