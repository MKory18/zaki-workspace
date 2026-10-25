import { describe, expect, it } from "vitest";
import { cleanElements, isNewer, mergeElements, type BoardElement } from "@/server/chat/whiteboard";

const el = (id: string, version: number, versionNonce = 1, extra: Partial<BoardElement> = {}): BoardElement => ({ id, version, versionNonce, type: "rectangle", ...extra });

describe("the whiteboard keeps, per element, the newer edit", () => {
  it("a higher version wins; on a tie the lower nonce wins (Excalidraw's own rule)", () => {
    expect(isNewer(el("a", 3), el("a", 2))).toBe(true);
    expect(isNewer(el("a", 2), el("a", 3))).toBe(false);
    expect(isNewer(el("a", 2, 5), el("a", 2, 9))).toBe(true);
    expect(isNewer(el("a", 2, 9), el("a", 2, 5))).toBe(false);
    expect(isNewer(el("a", 1), undefined)).toBe(true);
  });

  it("two people drawing at once: each one's strokes stay, an older copy never wipes a newer one", () => {
    const board = [el("a", 5), el("b", 1)];
    const merged = mergeElements(board, [el("a", 4, 1, { x: 99 }), el("c", 1)]);
    expect(merged.map((e) => [e.id, e.version])).toEqual([["a", 5], ["b", 1], ["c", 1]]);
  });

  it("a deletion travels: the newer element says isDeleted", () => {
    const merged = mergeElements([el("a", 1)], [el("a", 2, 1, { isDeleted: true })]);
    expect(merged[0]?.isDeleted).toBe(true);
  });

  it("keeps Excalidraw's drawing order (the fractional index)", () => {
    const merged = mergeElements([el("x", 1, 1, { index: "a2" })], [el("y", 1, 1, { index: "a1" })]);
    expect(merged.map((e) => e.id)).toEqual(["y", "x"]);
  });

  it("drops what is not an element, and pictures (their bytes would need the files service)", () => {
    const out = cleanElements([el("a", 1), { id: "b" }, "x", null, el("c", 1, 1, { type: "image" }), el("d", 1, 1, { type: "embeddable" })]);
    expect(out.map((e) => e.id)).toEqual(["a"]);
  });

  it("refuses something that is not a list", () => {
    expect(() => cleanElements({})).toThrow();
  });
});
