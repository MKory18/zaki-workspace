import { describe, expect, it } from "vitest";
import { ORDER_MAX, applySavedOrder, cleanOrder, dmScope, moveWithinGroup, saveOrderSchema, scopeSchema, spaceScope } from "@/lib/chat/order";

const item = (id: string, pinned = false, archived = false) => ({ id, pinned, archived });
const key = (t: { pinned: boolean; archived: boolean }) => (t.archived ? "a" : t.pinned ? "p" : "u");
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("applySavedOrder: a person's own order over the server's default", () => {
  it("returns the default untouched when nothing is saved", () => {
    const base = [item("a"), item("b"), item("c")];
    expect(applySavedOrder(base, null, key)).toEqual(base);
    expect(applySavedOrder(base, [], key)).toEqual(base);
    expect(applySavedOrder(base, undefined, key)).toEqual(base);
  });

  it("puts the rows in the saved order", () => {
    const base = [item("a"), item("b"), item("c")];
    expect(ids(applySavedOrder(base, ["c", "a", "b"], key))).toEqual(["c", "a", "b"]);
  });

  it("keeps the moderator's pinned topics first, ordering each group on its own", () => {
    const base = [item("p1", true), item("p2", true), item("u1"), item("u2"), item("u3")];
    // the saved order puts the unpinned ones in front of the pinned: the pin still floats
    const out = applySavedOrder(base, ["u3", "u1", "p2", "p1", "u2"], key);
    expect(ids(out)).toEqual(["p2", "p1", "u3", "u1", "u2"]);
  });

  it("a topic that was unpinned since joins the unpinned group at its saved place", () => {
    const base = [item("p1", true), item("x"), item("y")];
    expect(ids(applySavedOrder(base, ["y", "p1", "x"], key))).toEqual(["p1", "y", "x"]);
  });

  it("a conversation the saved order does not know falls in at its default place", () => {
    // default: A B N C D (N is new); saved only knows D C A
    const base = [item("A"), item("B"), item("N"), item("C"), item("D")];
    const out = applySavedOrder(base, ["D", "C", "A", "B"], key);
    expect(ids(out)).toEqual(["D", "C", "N", "A", "B"]);
    // with B and N both unknown they stay where the server put them
    expect(ids(applySavedOrder(base, ["D", "C", "A"], key))).toEqual(["D", "B", "N", "C", "A"]);
  });

  it("ignores ids that disappeared or lost access, and repeated ids", () => {
    const base = [item("a"), item("b")];
    expect(ids(applySavedOrder(base, ["gone", "b", "b", "a", "lost"], key))).toEqual(["b", "a"]);
  });

  it("never loses or duplicates a row", () => {
    const base = Array.from({ length: 40 }, (_, i) => item(`t${i}`, i % 7 === 0, i % 11 === 0 && i % 7 !== 0));
    const saved = [...base].reverse().map((x) => x.id).filter((_, i) => i % 3 !== 0);
    const out = applySavedOrder(base, saved, key);
    expect(ids(out).sort()).toEqual(ids(base).sort());
    expect(new Set(ids(out)).size).toBe(base.length);
  });

  it("does not change the list it was given", () => {
    const base = [item("a"), item("b")];
    applySavedOrder(base, ["b", "a"], key);
    expect(ids(base)).toEqual(["a", "b"]);
  });

  it("one group when no grouping function is given (the private chats)", () => {
    const base = [item("a"), item("b"), item("c")];
    expect(ids(applySavedOrder(base, ["b", "c"]))).toEqual(["a", "b", "c"]);
    expect(ids(applySavedOrder(base, ["c", "b"]))).toEqual(["a", "c", "b"]);
  });
});

describe("moveWithinGroup: a drag turned into the whole saved list", () => {
  it("moves one row inside its group and leaves every other slot alone", () => {
    // pinned P1 P2, unpinned A B C: dragging C above A
    const full = ["P1", "P2", "A", "B", "C"];
    expect(moveWithinGroup(full, ["A", "B", "C"], "C", "A")).toEqual(["P1", "P2", "C", "A", "B"]);
  });

  it("works for a group whose rows are not next to each other (a مقطع inside the space's list)", () => {
    const full = ["a1", "x1", "a2", "x2", "a3"];
    expect(moveWithinGroup(full, ["a1", "a2", "a3"], "a1", "a3")).toEqual(["a2", "x1", "a3", "x2", "a1"]);
  });

  it("refuses a drop onto a row of another group or onto itself", () => {
    const full = ["P1", "A", "B"];
    expect(moveWithinGroup(full, ["A", "B"], "A", "P1")).toBeNull();
    expect(moveWithinGroup(full, ["A", "B"], "A", "A")).toBeNull();
    expect(moveWithinGroup(full, ["A", "B"], "zzz", "A")).toBeNull();
  });
});

describe("cleanOrder: what is read back from the database", () => {
  it("keeps strings once, in order, up to the limit, and survives garbage", () => {
    expect(cleanOrder(["a", "b", "a", 3, null, "", "c"])).toEqual(["a", "b", "c"]);
    expect(cleanOrder("nope")).toEqual([]);
    expect(cleanOrder(null)).toEqual([]);
    expect(cleanOrder({ a: 1 })).toEqual([]);
    expect(cleanOrder(Array.from({ length: ORDER_MAX + 20 }, (_, i) => `id${i}`))).toHaveLength(ORDER_MAX);
  });
});

describe("validation", () => {
  it("accepts the three scopes and nothing else", () => {
    expect(scopeSchema.safeParse(spaceScope("clx1abc")).success).toBe(true);
    expect(scopeSchema.safeParse(dmScope(null)).success).toBe(true);
    expect(scopeSchema.safeParse(dmScope("clx1abc")).success).toBe(true);
    for (const bad of ["", "space:", "space:a b", "dms", "dm:", "topic:x", "space:../x", `space:${"x".repeat(60)}`]) {
      expect(scopeSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("limits the list to 500 strings", () => {
    const ok = saveOrderSchema.safeParse({ scope: "dm", order: Array.from({ length: ORDER_MAX }, (_, i) => `c${i}`) });
    expect(ok.success).toBe(true);
    expect(saveOrderSchema.safeParse({ scope: "dm", order: Array.from({ length: ORDER_MAX + 1 }, (_, i) => `c${i}`) }).success).toBe(false);
    expect(saveOrderSchema.safeParse({ scope: "dm", order: [1, 2] }).success).toBe(false);
    expect(saveOrderSchema.safeParse({ scope: "dm" }).success).toBe(false);
  });
});
