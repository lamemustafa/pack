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

  it("rejects sensitive policy markers from the vendored harness snapshot", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "assets/leak.js",
      "console.log('27ABCDE1234F1Z5 ABCDE1234F /Users/example/Downloads/gstr3b.pdf');",
    );

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("agent-harness-policy.snapshot.json");
    expect(result.output).toContain("gstin");
  });

  it("rejects sensitive policy markers in packaged manifest fields", async () => {
    const outputDir = await createValidPackage();
    const manifestPath = path.join(outputDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          ...manifest,
          version_name: "/Users/example/Downloads/27ABCDE1234F1Z5",
        },
        null,
        2,
      )}\n`,
    );

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("agent-harness-policy.snapshot.json");
    expect(result.output).toContain("gstin");
  });

  it("rejects sensitive policy markers in packaged filenames", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(outputDir, "assets/27ABCDE1234F1Z5.js", "const packLocalOnly = true;");

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("agent-harness-policy.snapshot.json");
    expect(result.output).toContain("gstin");
  });

  it("fails closed when the harness policy snapshot omits required redactors", async () => {
    const outputDir = await createValidPackage();
    const snapshotPath = path.join(outputDir, "bad-policy-snapshot.json");
    await writeFile(
      snapshotPath,
      `${JSON.stringify(
        {
          manifest: {
            policySchemaVersion: 1,
            policyVersion: "1.0.0",
            sourceRepository: "complyeaze",
            sourceCommit: "0123456789abcdef0123456789abcdef01234567",
            canonicalPolicySha256:
              "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            generatorVersion: "1.0.0",
          },
          policy: {
            redaction: {
              patterns: [],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = await runVerifier(outputDir, {
      PACK_HARNESS_POLICY_PATH: snapshotPath,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("missing redaction pattern gstin");
  });

  it("fails closed when the harness policy snapshot misses Linux or Windows home paths", async () => {
    const outputDir = await createValidPackage();
    const snapshotPath = path.join(outputDir, "bad-policy-snapshot.json");
    await writeFile(
      snapshotPath,
      `${JSON.stringify(
        {
          manifest: {
            policySchemaVersion: 1,
            policyVersion: "1.0.0",
            sourceRepository: "complyeaze",
            sourceCommit: "0123456789abcdef0123456789abcdef01234567",
            canonicalPolicySha256:
              "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            generatorVersion: "1.0.0",
          },
          policy: {
            redaction: {
              patterns: [
                { id: "gstin", pattern: "\\b\\d{2}[A-Z]{5}\\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\\b" },
                { id: "pan", pattern: "\\b[A-Z]{5}\\d{4}[A-Z]\\b" },
                { id: "openai-secret", pattern: "\\bsk-(?:proj-)?[A-Za-z0-9_-]+\\b" },
                { id: "cookie-header", pattern: "\\b(cookie|authorization)\\s*[:=]\\s*[^\\s;]+" },
                { id: "home-path", pattern: "/Users/[^\\s\"']+" },
                {
                  id: "gst-url",
                  pattern: "https://(?:www|services|return)\\.gst\\.gov\\.in/[^\\s\"']*",
                },
              ],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = await runVerifier(outputDir, {
      PACK_HARNESS_POLICY_PATH: snapshotPath,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("redaction pattern home-path missed /home/example");
  });

  it("allows approved GST portal origins in packaged extension code", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "assets/background.js",
      "const approvedOrigin = 'https://services.gst.gov.in';",
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(0);
  });

  it("rejects pathful GST portal URLs in packaged extension code", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "assets/background.js",
      "const capturedRoute = 'https://services.gst.gov.in/services/auth/efiledreturns';",
    );

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Pathful GST Portal URL");
  });

  it("rejects pathful GST portal URLs in packaged manifest fields", async () => {
    const outputDir = await createValidPackage();
    const manifestPath = path.join(outputDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          ...manifest,
          version_name: "https://services.gst.gov.in/services/auth/efiledreturns",
        },
        null,
        2,
      )}\n`,
    );

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Pathful GST Portal URL");
  });

  it("keeps exact ZIP verification wired to browser-loaded release checks", async () => {
    const script = await readFile(
      path.join(rootDir, "scripts", "verify-extension-zip.mjs"),
      "utf8",
    );
    const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(script).toContain("scripts/verify-extension-browser.mjs");
    expect(packageJson.scripts["verify:browser"]).toBe(
      "node scripts/verify-extension-browser.mjs .output/chrome-mv3",
    );
    expect(packageJson.devDependencies["@playwright/test"]).toBe("1.55.1");
  });

  it("keeps browser release verification fail-closed around popup, scripts, network, and runtime errors", async () => {
    const script = await readFile(
      path.join(rootDir, "scripts", "verify-extension-browser.mjs"),
      "utf8",
    );

    expect(script).toContain("contentScripts.length !== 1");
    expect(script).toContain("assertPopupPageLoads");
    expect(script).toContain("assertNoBrowserRuntimeFailures");
    expect(script).toContain("Pack host permissions must stay on the approved GST allow-list");
    expect(script).toContain("buildApprovedOrigins(manifest)");
    expect(script).toContain("LIVE_RUN_SENSITIVE_PATTERN_DEFINITIONS");
    expect(script).toContain("sanitize(message)");
    expect(script).toContain("unexpectedDeniedRequests.length > 0");
    expect(script).toContain("isExpectedDeniedNetworkProbe");
    expect(script).toContain("recordBrowserEvent");
    expect(script).toContain("pattern.test(entry.raw)");
    expect(script).toContain("PACK_BROWSER_XVFB");
    expect(script).toContain("xvfb-run");
    expect(script).toContain("--disable-background-networking");
    expect(script).toContain("--disable-component-update");
    expect(script).toContain("--host-resolver-rules=MAP * 127.0.0.1");
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

async function runVerifier(
  outputDir: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ output: string; status: number }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/verify-extension-package.mjs", outputDir],
      { cwd: rootDir, env: { ...process.env, ...env } },
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
