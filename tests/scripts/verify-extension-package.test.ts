import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const rootDir = process.cwd();
const createdDirs: string[] = [];

/**
 * The package verifier had no test of its own, so the gate protecting the built
 * extension was itself unprotected. These drive the real script as a subprocess
 * against a synthetic package rather than re-implementing its logic, because a
 * re-implementation would have agreed with the bug.
 */
describe("Pack extension package verifier", () => {
  afterEach(async () => {
    await Promise.all(
      createdDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
    );
  });

  it("accepts a well-formed package", async () => {
    const result = await runVerifier(await createPackage());

    expect(result.status).toBe(0);
    expect(result.output).toContain("verification passed");
  });

  it("rejects a single-quoted script reference whose bundle is absent", async () => {
    // The replaced regexes matched only double-quoted attributes, so this
    // package verified clean while shipping a page whose script is not there.
    const dir = await createPackage({
      "panel.html": page(`<script type="module" src='/assets/absent-single-quoted.js'></script>`),
    });

    const result = await runVerifier(dir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("assets/absent-single-quoted.js");
  });

  it("rejects a stylesheet whose href precedes its rel and whose file is absent", async () => {
    // The replaced regex required `rel` before `href`; HTML does not.
    const dir = await createPackage({
      "panel.html": page(`<link href="/assets/absent-reordered.css" rel="stylesheet">`),
    });

    const result = await runVerifier(dir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("assets/absent-reordered.css");
  });

  it("rejects a reference whose tag carries an angle bracket inside a quoted value", async () => {
    // `[^>]+` ended the tag at the `>` inside the attribute value, losing the
    // `src` that followed it.
    const dir = await createPackage({
      "panel.html": page(`<script data-note="a>b" src="/assets/absent-bracketed.js"></script>`),
    });

    const result = await runVerifier(dir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("assets/absent-bracketed.js");
  });

  it("rejects a stylesheet declared through a multi-token rel", async () => {
    const dir = await createPackage({
      "panel.html": page(`<link rel="preload stylesheet" href="/assets/absent-preloaded.css">`),
    });

    const result = await runVerifier(dir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("assets/absent-preloaded.css");
  });

  it("rejects a package whose side panel is not bound to the panel page", async () => {
    // Requiring panel.html to exist says nothing about whether the toolbar
    // action reaches it. Without this the fixture below passes with no binding
    // at all, and a package whose button does nothing clears every check.
    const dir = await createPackage({}, (manifest) => {
      delete manifest.side_panel;
    });

    const result = await runVerifier(dir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("side panel");
  });

  it("rejects a package whose action still declares a popup", async () => {
    // A default_popup takes precedence over the action's click event, so this
    // package opens the popup while advertising a side panel.
    const dir = await createPackage({}, (manifest) => {
      (manifest.action as Record<string, unknown>).default_popup = "popup.html";
    });

    const result = await runVerifier(dir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("must not declare a popup");
  });

  it("accepts a non-stylesheet link to a file the package does not contain", async () => {
    // Reading attributes rather than one composed shape must not widen what
    // counts as a bundle. An icon link is not one, and failing the build on it
    // would reject a legitimate package.
    const dir = await createPackage({
      "panel.html": page(`<link rel="icon" href="/assets/unpackaged-icon.png">`),
    });

    const result = await runVerifier(dir);

    expect(result.status).toBe(0);
    expect(result.output).toContain("verification passed");
  });
});

const REQUIRED_ICONS: Record<string, string> = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png",
};

const REQUIRED_BRAND_ASSETS = [
  "favicon.ico",
  "icons/icon-256.png",
  "icons/icon-512.png",
  "brand/pack-favicon.svg",
  "brand/pack-logo-header.svg",
  "brand/pack-mark.svg",
  "brand/pack-icon.svg",
  "brand/pack-logo.svg",
  "brand/pack-logo-hero.svg",
  "brand/pack-logo-monochrome.svg",
  "brand/pack-logo-monochrome-outlined.svg",
  "brand/pack-logo-outlined.svg",
  "brand/pack-logo-reversed.svg",
  "brand/pack-logo-reversed-outlined.svg",
];

const REQUIRED_PAGES = ["offscreen.html", "options.html", "panel.html"];

function page(head: string): string {
  return `<!doctype html><html><head>${head}</head><body>Pack</body></html>`;
}

/**
 * Writes the smallest package the verifier accepts. Overriding a page replaces
 * its markup and omits the bundles the default markup would have referenced, so
 * a test states only the reference it is about.
 */
async function createPackage(
  pages: Record<string, string> = {},
  mutateManifest: (manifest: Record<string, unknown>) => void = () => {},
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pack-extension-package-"));
  createdDirs.push(dir);

  const write = async (relativePath: string, contents: string) => {
    await mkdir(path.dirname(path.join(dir, relativePath)), { recursive: true });
    await writeFile(path.join(dir, relativePath), contents);
  };

  const manifest = JSON.parse(
    JSON.stringify({
      manifest_version: 3,
      name: "ComplyEaze Pack: GST Return Downloader",
      short_name: "ComplyEaze Pack",
      description:
        "Alpha: locally download GSTR-1/GSTR-3B files; private GSTR-2B downloads are source-build experimental.",
      homepage_url: "https://pack.complyeaze.com/gst",
      version: "0.0.0",
      icons: REQUIRED_ICONS,
      action: { default_title: "ComplyEaze Pack", default_icon: REQUIRED_ICONS },
      permissions: ["downloads", "offscreen", "scripting", "sidePanel", "storage"],
      side_panel: { default_path: "panel.html" },
      host_permissions: [
        "https://www.gst.gov.in/*",
        "https://services.gst.gov.in/*",
        "https://return.gst.gov.in/*",
        "https://gstr2b.gst.gov.in/*",
      ],
      content_security_policy: { extension_pages: "script-src 'self'; object-src 'self';" },
    }),
  ) as Record<string, unknown>;
  mutateManifest(manifest);
  await write("manifest.json", JSON.stringify(manifest));

  for (const assetPath of [...Object.values(REQUIRED_ICONS), ...REQUIRED_BRAND_ASSETS]) {
    await write(assetPath, "synthetic asset");
  }

  for (const pageName of REQUIRED_PAGES) {
    const override = pages[pageName];
    if (override !== undefined) {
      await write(pageName, override);
      continue;
    }
    await write(
      pageName,
      page(
        `<link rel="stylesheet" href="/assets/${pageName}.css">` +
          `<script type="module" src="/assets/${pageName}.js"></script>`,
      ),
    );
    await write(`assets/${pageName}.css`, "body{}");
    await write(`assets/${pageName}.js`, "export {};");
  }

  return dir;
}

function runVerifier(outputDir: string): Promise<{ output: string; status: number }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/verify-extension-package.mjs", outputDir],
      { cwd: rootDir },
      (error, stdout, stderr) => {
        resolve({
          output: `${stdout}${stderr}`,
          status: typeof error?.code === "number" ? error.code : error ? 1 : 0,
        });
      },
    );
  });
}
