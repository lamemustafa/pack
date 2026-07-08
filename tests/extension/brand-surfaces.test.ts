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
    const popupControllerSource = await readFile(
      path.join(rootDir, "src", "entrypoints", "popup", "use-pack-popup-controller.ts"),
      "utf8",
    );
    const optionsSource = await readFile(
      path.join(rootDir, "src", "entrypoints", "options", "main.tsx"),
      "utf8",
    );

    expect(popupSource).toContain("/brand/pack-logo-outlined.svg");
    expect(popupSource).not.toContain("ReviewerTools");
    expect(popupSource).not.toContain("PACK_CLEAR_LOCAL_DATA");
    expect(popupControllerSource).toContain("PACK_ACKNOWLEDGE_INTERRUPTED_RUN");
    expect(popupControllerSource).toContain("PACK_RETRY_FILED_RETURNS_TARGET");
    expect(popupControllerSource).toContain("PACK_RESOLVE_UNCONFIRMED_DOWNLOAD");
    expect(popupControllerSource).toContain("PACK_RETRY_FULL_FISCAL_YEAR_TARGET");
    expect(popupControllerSource).toContain("PACK_RESOLVE_FULL_FISCAL_YEAR_TARGET");
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

  it("keeps the popup target-first and broad enough for operational controls", async () => {
    const globalCss = await readFile(path.join(rootDir, "src", "styles", "global.css"), "utf8");
    const popupCss = await readFile(path.join(rootDir, "src", "styles", "popup.css"), "utf8");
    const controlsCss = await readFile(
      path.join(rootDir, "src", "styles", "popup-controls.css"),
      "utf8",
    );
    const targetCss = await readFile(
      path.join(rootDir, "src", "styles", "popup-target-summary.css"),
      "utf8",
    );

    expect(globalCss).toContain("--pack-popup-width: 780px;");
    expect(globalCss).toContain("--pack-popup-min-height: 580px;");
    expect(globalCss).toContain("--pack-popup-max-height: 580px;");
    expect(popupCss).toContain(
      "grid-template-columns: minmax(0, 1.6fr) minmax(270px, 0.8fr);",
    );
    expect(popupCss).toContain(".run-column");
    expect(popupCss).toContain("position: static;");
    expect(controlsCss).toContain(
      "grid-template-columns: minmax(0, 1fr) minmax(170px, 0.42fr);",
    );
    expect(controlsCss).toContain("@media (max-width: 700px)");
    expect(targetCss).toContain(
      "grid-template-columns: minmax(170px, 0.42fr) minmax(0, 1fr);",
    );
    expect(targetCss).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
  });
});
