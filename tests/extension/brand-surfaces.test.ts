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

    expect(popupSource).toContain("/brand/pack-logo-outlined.svg");
    expect(popupSource).not.toContain("ReviewerTools");
    expect(popupSource).not.toContain("PACK_CLEAR_LOCAL_DATA");
    expect(popupSource).toContain("PACK_ACKNOWLEDGE_INTERRUPTED_RUN");
    expect(popupSource).toContain("PACK_RETRY_FILED_RETURNS_TARGET");
    expect(popupSource).toContain("PACK_RESOLVE_UNCONFIRMED_DOWNLOAD");
    expect(optionsSource).toContain("/icons/icon-48.png");
    expect(optionsSource).toContain("PACK_START_SYNTHETIC_DEMO");
    expect(optionsSource).toContain("Last synthetic demo manifest");
    expect(optionsSource).toContain("PACK_CLEAR_LOCAL_DATA");
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
