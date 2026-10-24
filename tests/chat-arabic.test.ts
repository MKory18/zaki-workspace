import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";

/**
 * The chat's words (review D items 8 and 11): every chat string lives in an ar.chat-*.json fragment,
 * where the Arabic guards read it, never as a literal in a chat component; the chat's errors are
 * Modern Standard Arabic (errors, permissions and system labels are; dialect is for the guide, tours,
 * Today, sign-in and onboarding); and one thing has one name.
 */

const CHAT_UI = path.join(process.cwd(), "src", "components", "chat");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? tsxFiles(full) : /\.(tsx|ts)$/.test(name) ? [full] : [];
  });
}

/** The code without its comments (a comment may quote the Arabic it is about). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("the chat's words live in the dictionary", () => {
  it("finds the chat components (so the check below is not vacuous)", () => {
    expect(tsxFiles(CHAT_UI).length).toBeGreaterThan(8);
  });

  it("no chat component writes Arabic in its code: it asks ct()/t() for a key", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(CHAT_UI)) {
      const code = withoutComments(readFileSync(file, "utf8"));
      code.split(/\r?\n/).forEach((line, i) => {
        if (/[؀-ۿ]/.test(line)) offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}  ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("the chat's errors speak Modern Standard Arabic, with one name for each thing", () => {
  const errors = Object.entries(AR).filter(([key]) => key.startsWith("chat.e.") || key === "chat.not_found");

  it("finds the chat's errors", () => {
    expect(errors.length).toBeGreaterThan(15);
  });

  it("no dialect in an error (the conversation screen around them is MSA)", () => {
    const dialect = /(^|\s)(ما ب|ما عندك|هال|هون|بس[ .،]|شوي|كتير|لسا|بدك|اللي|شيل|ابعت|بتقدر|بيقدر|ما لقينا|استنى)/;
    for (const [key, text] of errors) expect(text, key).not.toMatch(dialect);
  });

  it("«الزائر», never «الضيف»; «كتم», never «تسكيت»", () => {
    for (const [key, text] of errors) {
      expect(text, key).not.toMatch(/الضيف|تسكّت|تسكيت/);
    }
    expect(AR["chat.e.guest_no_dm"]).toContain("الزائر");
    expect(AR["chat.e.mute_denied"]).toContain("كتم");
  });

  it("closed is «مغلق» everywhere in the chat and the archive (it was written five ways)", () => {
    const chatAndArchive = Object.entries(AR).filter(([key]) => /^(chat|chatc|chath|archive)\./.test(key));
    for (const [key, text] of chatAndArchive) expect(text, key).not.toMatch(/مقفول|المقفلة|مقفلة/);
    expect(AR["archive.type.closed"]).toBe("المغلق");
  });
});
