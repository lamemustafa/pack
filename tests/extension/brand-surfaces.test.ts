import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

describe("Pack brand surfaces", () => {
  it("uses Pack iconography in popup and options UI sources", async () => {
    const popupSource = await readFile(
      path.join(rootDir, "src", "entrypoints", "popup", "main.tsx"),
      "utf8",
    );
    const optionsSource = await readFile(
      path.join(rootDir, "src", "entrypoints", "options", "main.tsx"),
      "utf8",
    );

    expect(popupSource).toContain("/icons/icon-48.png");
    expect(optionsSource).toContain("/icons/icon-48.png");
  });

  it("declares the Pack favicon on extension pages", async () => {
    const popupHtml = await readFile(
      path.join(rootDir, "src", "entrypoints", "popup", "index.html"),
      "utf8",
    );
    const optionsHtml = await readFile(
      path.join(rootDir, "src", "entrypoints", "options", "index.html"),
      "utf8",
    );

    expect(popupHtml).toContain('href="/favicon.ico"');
    expect(optionsHtml).toContain('href="/favicon.ico"');
  });
});
