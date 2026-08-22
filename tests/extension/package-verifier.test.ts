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

  it("rejects an empty required brand asset", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(outputDir, "brand/pack-mark.svg", "");

    const result = await runVerifier(outputDir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Required brand asset is empty: brand/pack-mark.svg");
  });

  it("rejects an empty extension page", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(outputDir, "popup.html", "");

    // An empty page references nothing, so a bundle check alone would pass it.
    const result = await runVerifier(outputDir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Required extension page is empty: popup.html");
  });

  it("rejects a page whose referenced bundle is missing", async () => {
    const outputDir = await createValidPackage();
    await rm(path.join(outputDir, "chunks", "popup.js"));

    // A page that can be read is not a page that works.
    const result = await runVerifier(outputDir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing asset referenced by popup.html: chunks/popup.js");
  });

  it("rejects a page whose referenced bundle is empty", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(outputDir, "chunks/popup.js", "");

    const result = await runVerifier(outputDir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Asset referenced by popup.html is empty");
  });

  it("accepts packaged HTML without module preload hints", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "popup.html",
      '<!doctype html><html><body><script type="module" src="/chunks/popup.js"></script></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(0);
  });

  it("rejects module preload hints in any packaged HTML", async () => {
    const cases = [
      { file: "pages/quoted.html", rel: 'rel="modulepreload"' },
      { file: "pages/multi-token.html", rel: 'rel="preload modulepreload"' },
      { file: "pages/unquoted.html", rel: "rel=modulepreload" },
    ];

    for (const preloadCase of cases) {
      const outputDir = await createValidPackage();
      await writePackageFile(
        outputDir,
        preloadCase.file,
        `<!doctype html><html><head><link ${preloadCase.rel} href="/chunks/shared.js"></head></html>`,
      );

      const result = await runVerifier(outputDir);

      expect(result.status).not.toBe(0);
      expect(result.output).toContain(`Module preload hint in ${preloadCase.file}`);
    }
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

  it("rejects debugger/CDP permission in the packaged manifest", async () => {
    const outputDir = await createValidPackage();
    const manifestPath = path.join(outputDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      permissions: string[];
    };
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          ...manifest,
          permissions: [...manifest.permissions, "debugger"],
        },
        null,
        2,
      )}\n`,
    );

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("debugger");
  });

  it("rejects optional debugger permission", async () => {
    const outputDir = await createValidPackage();
    const manifestPath = path.join(outputDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          ...manifest,
          optional_permissions: ["debugger"],
        },
        null,
        2,
      )}\n`,
    );

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("optional permissions");
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
      "console.log('00XXXXX0000X0Z0 XXXXX0000X /Users/example/Downloads/gstr3b.pdf');",
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
          version_name: "/Users/example/Downloads/00XXXXX0000X0Z0",
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
    await writePackageFile(outputDir, "assets/00XXXXX0000X0Z0.js", "const packLocalOnly = true;");

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
                { id: "gstin", pattern: "\\b\\d{2}[A-Z]{5}\\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\\b" },
                { id: "pan", pattern: "\\b[A-Z]{5}\\d{4}[A-Z]\\b" },
                { id: "openai-secret", pattern: "\\bsk-(?:proj-)?[A-Za-z0-9_-]+\\b" },
                { id: "cookie-header", pattern: "\\b(cookie|authorization)\\s*[:=]\\s*[^\\s;]+" },
                { id: "home-path", pattern: "/Users/[^\\s\"']+" },
                {
                  id: "gst-url",
                  pattern: "https://(?:www|services|return|gstr2b)\\.gst\\.gov\\.in/[^\\s\"']*",
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

  it("fails closed when the harness policy snapshot digest is stale", async () => {
    const outputDir = await createValidPackage();
    const snapshotDir = await mkdtemp(path.join(tmpdir(), "pack-policy-"));
    createdDirs.push(snapshotDir);
    const snapshotPath = path.join(snapshotDir, "stale-policy-snapshot.json");
    const snapshot = JSON.parse(
      await readFile(path.join(rootDir, "policies", "agent-harness-policy.snapshot.json"), "utf8"),
    ) as {
      manifest: Record<string, unknown>;
      policy: { redaction: { patterns: Array<Record<string, unknown>> } };
    };
    snapshot.policy.redaction.patterns.push({
      id: "extra-test-pattern",
      label: "<EXTRA>",
      pattern: "extra-test-pattern",
    });
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

    const result = await runVerifier(outputDir, {
      PACK_HARNESS_POLICY_PATH: snapshotPath,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("canonicalPolicySha256 does not match snapshot.policy");
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

  it("allows the approved GSTR-2B summary app route in packaged extension code", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "assets/background.js",
      "const gstr2bSummary = 'https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary';",
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

  it("rejects a package missing any extension page", async () => {
    // A build that dropped a page still loaded as an extension, with a dead surface behind
    // the action. Only offscreen.html was asserted, so nothing failed.
    for (const page of ["offscreen.html", "options.html", "panel.html", "popup.html"]) {
      const outputDir = await createValidPackage();
      await rm(path.join(outputDir, page));

      const result = await runVerifier(outputDir);

      expect(result.status).not.toBe(0);
      expect(result.output).toContain(`Missing required extension page: ${page}`);
    }
  });

  it("rejects a package missing a brand asset a Pack page loads at runtime", async () => {
    for (const asset of [
      "brand/pack-favicon.svg",
      "brand/pack-logo-header.svg",
      "brand/pack-mark.svg",
    ]) {
      const outputDir = await createValidPackage();
      await rm(path.join(outputDir, asset));

      const result = await runVerifier(outputDir);

      expect(result.status).not.toBe(0);
      expect(result.output).toContain(`Missing required brand asset: ${asset}`);
    }
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
    expect(packageJson.devDependencies["@playwright/test"]).toBe("1.62.1");
  });

  it("keeps browser release verification fail-closed around popup, scripts, network, and runtime errors", async () => {
    const script = await readFile(
      path.join(rootDir, "scripts", "verify-extension-browser.mjs"),
      "utf8",
    );

    expect(script).toContain("expectedContentScripts.length");
    expect(script).toContain("content-scripts/content.js");
    expect(script).not.toContain("content-scripts/gstr2b-capture-main.js");
    expect(script).toContain("Pack release must include only the approved content scripts.");
    expect(script).toContain("assertPopupPageLoads");
    expect(script).toContain("valid context state");
    expect(script).toContain("waitForFunction");
    expect(script).toContain("visibleWordmark");
    expect(script).toContain("shellRect.width < 380");
    expect(script).toContain("shellRect.width > 460");
    expect(script).toContain("https://services.gst.gov.in/services/auth/fowelcome");
    expect(script).toContain("readLoadedExtensionIdFromPreferences");
    expect(script).toContain("chrome-extension://${extensionId}/popup.html");
    expect(script).toContain('waitForEvent("serviceworker"');
    expect(script.indexOf('waitForEvent("serviceworker"')).toBeLessThan(
      script.indexOf("wakePage.goto(`chrome-extension://${extensionId}/popup.html`"),
    );
    expect(script).toContain("findExtensionServiceWorker(browserContext, extensionId)");
    expect(script).toContain(
      "predicate: (worker) => isExtensionServiceWorker(worker, extensionId)",
    );
    expect(script).toContain('workerUrl.protocol === "chrome-extension:"');
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

describe("packaged page reference parsing", () => {
  // These drive the same script and the same fixture as the suite above. They
  // began as a separate file with its own hand-maintained manifest, host set,
  // page list and brand assets -- a second copy of everything `createValidPackage`
  // already owns, which is the duplication this repo keeps paying for.
  const page = (head: string) =>
    `<!doctype html><html><head>${head}</head><body>Pack</body></html>`;

  it("rejects a single-quoted script reference whose bundle is absent", async () => {
    // The replaced regexes matched only double-quoted attributes, so this
    // package verified clean while shipping a page whose script is not there.
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      page(`<script type="module" src='/assets/absent-single-quoted.js'></script>`),
    );

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("assets/absent-single-quoted.js");
  });

  it("rejects a stylesheet whose href precedes its rel and whose file is absent", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      page(`<link href="/assets/absent-reordered.css" rel="stylesheet">`),
    );

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("assets/absent-reordered.css");
  });

  it("rejects a reference whose tag carries an angle bracket inside a quoted value", async () => {
    // `[^>]+` ended the tag at the `>` inside the attribute value, losing the
    // `src` that followed it.
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      page(`<script data-note="a>b" src="/assets/absent-bracketed.js"></script>`),
    );

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("assets/absent-bracketed.js");
  });

  it("rejects a stylesheet declared through a multi-token rel", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      page(`<link rel="preload stylesheet" href="/assets/absent-preloaded.css">`),
    );

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("assets/absent-preloaded.css");
  });

  it("accepts a non-stylesheet link to a file the package does not contain", async () => {
    // Reading attributes rather than one composed shape must not widen what
    // counts as a bundle. An icon link is not one.
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      page(`<link rel="icon" href="/assets/unpackaged-icon.png">`),
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(0);
  });

  it("still sees a real script after an inline one containing tag-shaped text", async () => {
    // The first raw-text fix collected openers up front and mutated as it went,
    // so a stale offset made the scan run past the real closing tag and blank
    // the NEXT script's opening tag. A package missing that bundle then verified
    // clean -- a hole in the gate opened by the fix for another hole in it.
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      page(
        `<script>window.t = "<script>";</script>` +
          `<script type="module" src="/assets/absent-after-inline.js"></script>`,
      ),
    );

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("assets/absent-after-inline.js");
  });

  it("ignores tag-shaped text inside an inline script body", async () => {
    // A script body is raw text to an HTML parser, so a tag-shaped string in it
    // is a string. Scanning it as markup failed the build for an asset nothing
    // loads.
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      page(`<script>window.template = "<script src='/assets/ghost.js'>";</script>`),
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(0);
  });

  it("ignores a commented-out reference to a file the package does not contain", async () => {
    // Scanning raw markup treated a disabled tag as live, so a page carrying a
    // commented-out script failed the build for an asset it never loads. A gate
    // that rejects a valid package is worse than one that misses a case.
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      page(`<!-- <script type="module" src='/assets/removed.js'></script> -->`),
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(0);
  });
});

async function createValidPackage(): Promise<string> {
  const outputDir = await mkdtemp(path.join(tmpdir(), "pack-extension-"));
  createdDirs.push(outputDir);

  const manifest = {
    manifest_version: 3,
    name: "ComplyEaze Pack: GST Return Downloader",
    short_name: "ComplyEaze Pack",
    description:
      "Alpha: locally download GSTR-1/GSTR-3B files; private GSTR-2B downloads are source-build experimental.",
    homepage_url: "https://pack.complyeaze.com/gst",
    permissions: ["downloads", "offscreen", "scripting", "storage"],
    host_permissions: [
      "https://www.gst.gov.in/*",
      "https://services.gst.gov.in/*",
      "https://return.gst.gov.in/*",
      "https://gstr2b.gst.gov.in/*",
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
  for (const page of ["offscreen.html", "options.html", "panel.html", "popup.html"]) {
    const chunk = `chunks/${page.replace(".html", ".js")}`;
    await writePackageFile(
      outputDir,
      page,
      `<!doctype html><html><body><script type="module" src="/${chunk}"></script></body></html>`,
    );
    // The chunk each page references must exist for this to be a valid package.
    // It previously did not, so the fixture asserted a package that could never
    // load — the shape AGENTS.md warns about, where a fixture encodes what we
    // assumed rather than what the artifact contains.
    await writePackageFile(outputDir, chunk, "export {};\n");
  }
  for (const iconSize of [16, 32, 48, 128]) {
    await writePackageFile(outputDir, `icons/icon-${iconSize}.png`, "synthetic-png");
  }
  for (const assetPath of [
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
