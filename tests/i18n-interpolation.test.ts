import { describe, expect, it } from "vitest";
import { interpolate } from "../src/lib/i18n/interpolate";
import { getServerT } from "../src/lib/i18n/server";

describe("translation placeholders", () => {
  it("fills {name} placeholders, numbers included", () => {
    expect(interpolate("مرحبا {name}، عندك {n} مهام", { name: "راما", n: 3 })).toBe("مرحبا راما، عندك 3 مهام");
  });

  it("a value is inserted literally: $& and $$ inside a name or password are not replacement patterns", () => {
    expect(interpolate("كلمة المرور: {pw}", { pw: "a$&b" })).toBe("كلمة المرور: a$&b");
    expect(interpolate("كلمة المرور: {pw}", { pw: "x$$y" })).toBe("كلمة المرور: x$$y");
    expect(interpolate("كلمة المرور: {pw}", { pw: "q$1z$`w" })).toBe("كلمة المرور: q$1z$`w");
  });

  it("a value that looks like a placeholder is not filled in a second time", () => {
    expect(interpolate("{a} و{b}", { a: "{b}", b: "ثاني" })).toBe("{b} وثاني");
  });

  it("a placeholder with no value stays as it is, and no vars at all changes nothing", () => {
    expect(interpolate("{a} و{b}", { a: "1" })).toBe("1 و{b}");
    expect(interpolate("بلا متغيرات {a}")).toBe("بلا متغيرات {a}");
  });

  it("the server translator uses it", () => {
    const { t } = getServerT();
    expect(t("no.such.key.{x}", { x: "$&" })).toBe("no.such.key.$&");
  });
});
