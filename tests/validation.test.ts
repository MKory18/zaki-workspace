import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parse, parseJson } from "@/server/validation";
import { ValidationError } from "@/server/auth";

describe("validation.parse", () => {
  it("returns parsed data for valid input", () => {
    const schema = z.object({ title: z.string().min(1) });
    expect(parse(schema, { title: "Demo" })).toEqual({ title: "Demo" });
  });

  it("throws ValidationError with field paths", () => {
    const schema = z.object({ title: z.string().min(1) });
    try {
      parse(schema, { title: "" });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const ve = err as ValidationError;
      expect(ve.issues[0]!.path).toBe("title");
    }
  });
});

describe("validation.parseJson", () => {
  it("throws ValidationError on non-JSON body", async () => {
    const req = new Request("http://x", { method: "POST", body: "not json" });
    try {
      await parseJson(z.object({}), req);
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
    }
  });

  it("parses a valid JSON body", async () => {
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json" },
    });
    expect(await parseJson(z.object({ a: z.number() }), req)).toEqual({ a: 1 });
  });
});
