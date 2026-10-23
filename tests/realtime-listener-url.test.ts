import { describe, expect, it } from "vitest";
import { directPgUrl } from "@/server/realtime/listener";

describe("directPgUrl", () => {
  it("strips the ?pgbouncer/schema query parameters Prisma accepts but pg does not", () => {
    expect(
      directPgUrl("postgresql://zaki:pw@127.0.0.1:5440/zaki?pgbouncer=true&schema=public&connection_limit=10"),
    ).toBe("postgresql://zaki:pw@127.0.0.1:5440/zaki");
  });

  it("keeps a plain URL untouched", () => {
    expect(directPgUrl("postgresql://zaki:pw@127.0.0.1:5440/zaki")).toBe(
      "postgresql://zaki:pw@127.0.0.1:5440/zaki",
    );
  });

  it("keeps an sslmode parameter (pg honours it)", () => {
    expect(directPgUrl("postgresql://zaki:pw@h/zaki?sslmode=require")).toBe(
      "postgresql://zaki:pw@h/zaki?sslmode=require",
    );
  });
});
