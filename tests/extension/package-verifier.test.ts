import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const rootDir = process.cwd();
const createdDirs: string[] = [];

describe("extension package verifier", () => {
  afterEach(async () => {
    await Promise.all(
      createdDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
    );
  });

  it("accepts the expected local-only package manifest shape", async () => {
    const outputDir = await createValidPackage();

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(0);
    expect(result.output).toContain("Pack WXT extension package verification passed.");
  });

  it("rejects externally_connectable in the packaged manifest", async () => {
    const outputDir = await createValidPackage();
    const manifestPath = path.join(outputDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          ...manifest,
          externally_connectable: {
            matches: ["https://example.com/*"],
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("externally_connectable");
  });

  it("rejects analytics, crash-reporting, and replay markers in packaged artifacts", async () => {
    const cases = [
      {
        file: "assets/analytics.js",
        body: "import posthog from 'posthog-js'; posthog.init('project');",
        expected: "posthog-js",
      },
      {
        file: "assets/crash.js",
        body: "fetch('https://sentry.io/api/123/store/', { method: 'POST' });",
        expected: "sentry.io",
      },
      {
        file: "assets/replay.js",
        body: "window.LogRocket && LogRocket.init('pack/replay');",
        expected: "LogRocket",
      },
    ];

    for (const markerCase of cases) {
      const outputDir = await createValidPackage();
      await writePackageFile(outputDir, markerCase.file, markerCase.body);

      const result = await runVerifier(outputDir);

      expect(result.status).not.toBe(0);
      expect(result.output).toContain(markerCase.expected);
    }
  });
});

async function createValidPackage(): Promise<string> {
  const outputDir = await mkdtemp(path.join(tmpdir(), "pack-extension-"));
  createdDirs.push(outputDir);

  const manifest = {
    manifest_version: 3,
    name: "ComplyEaze Pack: GST GSTR-3B Downloader",
    short_name: "ComplyEaze Pack",
    description: "Download filed GSTR-3B PDFs locally from your GST Portal session.",
    homepage_url: "https://github.com/lamemustafa/pack",
    permissions: ["downloads", "scripting", "storage"],
    host_permissions: [
      "https://www.gst.gov.in/*",
      "https://services.gst.gov.in/*",
      "https://return.gst.gov.in/*",
    ],
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    action: {
      default_title: "ComplyEaze Pack",
      default_icon: {
        16: "icons/icon-16.png",
        32: "icons/icon-32.png",
        48: "icons/icon-48.png",
        128: "icons/icon-128.png",
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  };

  await writePackageFile(outputDir, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  for (const iconSize of [16, 32, 48, 128]) {
    await writePackageFile(outputDir, `icons/icon-${iconSize}.png`, "synthetic-png");
  }
  for (const assetPath of [
    "favicon.ico",
    "icons/icon-256.png",
    "icons/icon-512.png",
    "brand/pack-icon.svg",
    "brand/pack-logo.svg",
    "brand/pack-logo-hero.svg",
    "brand/pack-logo-monochrome.svg",
    "brand/pack-logo-monochrome-outlined.svg",
    "brand/pack-logo-outlined.svg",
    "brand/pack-logo-reversed.svg",
    "brand/pack-logo-reversed-outlined.svg",
  ]) {
    await writePackageFile(outputDir, assetPath, assetPath.endsWith(".svg") ? "<svg />" : "asset");
  }
  await writePackageFile(outputDir, "assets/background.js", "const packLocalOnly = true;");

  return outputDir;
}

async function writePackageFile(outputDir: string, relativePath: string, contents: string) {
  const filePath = path.join(outputDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function runVerifier(outputDir: string): Promise<{ output: string; status: number }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/verify-extension-package.mjs", outputDir],
      { cwd: rootDir },
      (error, stdout, stderr) => {
        resolve({
          output: `${stdout}${stderr}`,
          status:
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "number"
              ? error.code
              : error
                ? 1
                : 0,
        });
      },
    );
  });
}
