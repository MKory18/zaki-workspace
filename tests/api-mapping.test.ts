import { describe, expect, it } from "vitest";
import { z } from "zod";
import { apiError, withApi } from "@/server/api";
import { ForbiddenError, UnauthorizedError, ValidationError, NotFoundError } from "@/server/auth";

describe("api.withApi", () => {
  it("maps authentication errors to 401", async () => {
    const res = await withApi(async () => {
      throw new UnauthorizedError();
    });
    expect(res.status).toBe(401);
  });

  it("maps forbidden errors to 403", async () => {
    const res = await withApi(async () => {
      throw new ForbiddenError("nope");
    });
    expect(res.status).toBe(403);
  });

  it("maps not-found errors to 404", async () => {
    const res = await withApi(async () => {
      throw new NotFoundError("x");
    });
    expect(res.status).toBe(404);
  });

  it("maps validation errors to 422 with issue list", async () => {
    const res = await withApi(async () => {
      throw new ValidationError([{ path: "title", message: "required" }]);
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { details: { path: string }[] };
    expect(body.details[0]!.path).toBe("title");
  });

  it("maps unknown errors to 500 without leaking stack traces", async () => {
    const res = await withApi(async () => {
      throw new Error("boom with secret");
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("boom with secret");
  });

  it("apiError produces coded responses", () => {
    const res = apiError("auth.required");
    expect(res.status).toBe(401);
  });

  it("zod errors pass through with 422", async () => {
    const res = await withApi(async () => {
      z.string().email().parse("nope");
      return apiError("internal");
    });
    expect(res.status).toBe(422);
  });
});
