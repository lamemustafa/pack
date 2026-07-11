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

    expect(popupSource).toContain("/brand/pack-logo-header.svg");
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

    expect(popupHtml).toContain('href="/brand/pack-favicon.svg"');
    expect(optionsHtml).toContain('href="/brand/pack-favicon.svg"');
  });

  it("keeps the browser-action popup compact and task-first", async () => {
    const popupSource = await readFile(
      path.join(rootDir, "src", "entrypoints", "popup", "main.tsx"),
      "utf8",
    );
    const globalCss = await readFile(path.join(rootDir, "src", "styles", "global.css"), "utf8");
    const popupCss = await readFile(path.join(rootDir, "src", "styles", "popup.css"), "utf8");
    const controlsCss = await readFile(
      path.join(rootDir, "src", "styles", "popup-controls.css"),
      "utf8",
    );
    const popupComponentsSource = await readFile(
      path.join(rootDir, "src", "entrypoints", "popup", "components.tsx"),
      "utf8",
    );
    const packSummarySource = await readFile(
      path.join(rootDir, "src", "entrypoints", "popup", "pack-summary.tsx"),
      "utf8",
    );
    expect(globalCss).toContain("--pack-action-popup-width: 420px;");
    expect(globalCss).toContain("--pack-action-popup-max-height: 560px;");
    expect(globalCss).toContain("cursor: not-allowed;");
    expect(popupComponentsSource).toContain("Download GST returns");
    expect(packSummarySource).toContain("Your pack");
    expect(popupSource).toContain("InlineStatus");
    expect(popupCss).toContain(".inline-status");
    expect(popupCss).toContain("overflow-y: auto;");
    expect(popupCss).not.toContain("border-left-width: 3px;");
    expect(popupCss).toContain(".pack-summary");
    expect(controlsCss).toContain(".advanced-options");
    expect(controlsCss).toContain("position: sticky;");
    expect(controlsCss).toContain("bottom: 0;");
    expect(popupCss).not.toContain("radial-gradient");
    expect(controlsCss).not.toContain("linear-gradient");
  });
});
