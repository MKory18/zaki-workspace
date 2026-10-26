import { describe, expect, it } from "vitest";
import { bestGrid } from "@/lib/calls/layout";

describe("the call screen shares the room between the people", () => {
  it("one person takes the whole screen", () => {
    expect(bestGrid(1, 390, 700)).toEqual({ cols: 1, rows: 1 });
  });

  it("two people: stacked on a phone held upright, side by side when it is turned (the owner's «بالعرض بتحسها صغيرة»)", () => {
    expect(bestGrid(2, 390, 700)).toEqual({ cols: 1, rows: 2 });
    expect(bestGrid(2, 844, 300)).toEqual({ cols: 2, rows: 1 });
  });

  it("four people on a computer make two by two; six on a wide screen make three by two", () => {
    expect(bestGrid(4, 1280, 640)).toEqual({ cols: 2, rows: 2 });
    expect(bestGrid(6, 1600, 700)).toEqual({ cols: 3, rows: 2 });
  });

  it("a box not measured yet stacks everybody instead of dividing by zero", () => {
    expect(bestGrid(3, 0, 0)).toEqual({ cols: 1, rows: 3 });
  });
});
