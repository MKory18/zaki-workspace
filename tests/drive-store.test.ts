import { afterEach, describe, expect, it } from "vitest";
import { driveIdOf, driveNameFor, folderQuery, isDrivePath } from "../src/server/files/drive-store";
import { buildAuthUrl } from "../src/server/services/google";

describe("the library's Drive store: names and paths", () => {
  it("a version carries its number in Drive, before the extension", () => {
    expect(driveNameFor("plan.pdf", 1)).toBe("plan.pdf");
    expect(driveNameFor("plan.pdf", 2)).toBe("plan (نسخة 2).pdf");
    expect(driveNameFor("archive.tar.gz", 3)).toBe("archive.tar (نسخة 3).gz");
    expect(driveNameFor("README", 2)).toBe("README (نسخة 2)");
    expect(driveNameFor(".env", 2)).toBe(".env (نسخة 2)");
  });

  it("a Drive path is told apart from a server path, and gives its id back", () => {
    expect(isDrivePath("gdrive:abc123")).toBe(true);
    expect(driveIdOf("gdrive:abc123")).toBe("abc123");
    expect(isDrivePath("org1/file_v1_plan.pdf")).toBe(false);
  });

  it("a folder is searched by its tag, quotes escaped, never by its name", () => {
    expect(folderQuery("space:abc")).toBe(
      "mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='zaki' and value='space:abc' }",
    );
    expect(folderQuery("x' or name='y")).toContain("value='x\\' or name=\\'y'");
  });
});

describe("the Google consent asks for the app's own files only", () => {
  const saved = { id: process.env["GOOGLE_CLIENT_ID"], secret: process.env["GOOGLE_CLIENT_SECRET"] };
  afterEach(() => {
    for (const [key, value] of [["GOOGLE_CLIENT_ID", saved.id], ["GOOGLE_CLIENT_SECRET", saved.secret]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("drive.file (no review, the published app keeps its connection), not drive.readonly, and no older grants merged in", () => {
    process.env["GOOGLE_CLIENT_ID"] = "id";
    process.env["GOOGLE_CLIENT_SECRET"] = "secret";
    const url = new URL(buildAuthUrl("org-1", "user-1"));
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.has("include_granted_scopes")).toBe(false);
  });
});
