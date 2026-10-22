import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OpportunityStage } from "@prisma/client";
import { ALLOWED_REACTIONS } from "../src/server/services/chat";
import { CHAT_REACTIONS } from "../src/lib/chat-reactions";

const SRC = path.resolve(__dirname, "../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|json|css)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC);

describe("source encoding", () => {
  it("every source file is valid UTF-8", () => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (const file of files) {
      expect(() => decoder.decode(readFileSync(file)), file).not.toThrow();
    }
  });

  it("no mojibake (UTF-8 bytes re-read as a legacy code page) in the source", () => {
    // Sequences that appear when emoji / dashes / quotes were saved through the wrong code page.
    const MOJIBAKE = /ًں|â€|â‌|ï¸|Ã[\u0080-¿]|Ø[\u0080-¿]|Ù[\u0080-¿]/;
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (MOJIBAKE.test(line)) offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("chat reaction palette", () => {
  it("the UI palette is exactly the server allow-list (a mismatch makes every reaction fail)", () => {
    expect([...CHAT_REACTIONS]).toEqual([...ALLOWED_REACTIONS]);
  });
});

describe("translations", () => {
  const ar = JSON.parse(readFileSync(path.join(SRC, "lib/i18n/ar.json"), "utf8")) as Record<string, string>;

  it("every CRM opportunity stage has a label (it used to render the raw key)", () => {
    for (const stage of Object.values(OpportunityStage)) {
      expect(ar[`crm.stage_${stage.toLowerCase()}`], stage).toBeTruthy();
    }
  });

  it("every statically-referenced t('key') exists in ar.json", () => {
    const used = new Map<string, string>();
    for (const file of files.filter((f) => /\.(ts|tsx)$/.test(f))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\bt\(\s*["']([a-z][\w]*(?:\.[\w-]+)+)["']/g)) {
        if (!used.has(m[1]!)) used.set(m[1]!, path.relative(SRC, file));
      }
    }
    const missing = [...used.entries()].filter(([key]) => !(key in ar)).map(([key, file]) => `${key}  (${file})`);
    expect(missing).toEqual([]);
  });
});
