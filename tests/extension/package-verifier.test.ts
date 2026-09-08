import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  packagedReferencePath,
  packagedReferenceUrl,
} from "../../scripts/lib/packaged-reference-path.mjs";

const rootDir = process.cwd();
const createdDirs: string[] = [];
const renderedSourceSurface =
  'const surface = runtime.jsx("section", { "data-pack-source-surface": "full-fiscal-year" });\nexport default surface;\n';

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
    await writePackageFile(outputDir, "panel.html", "");

    // An empty page references nothing, so a bundle check alone would pass it.
    const result = await runVerifier(outputDir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Required extension page is empty: panel.html");
  });

  it("rejects a page whose referenced bundle is missing", async () => {
    const outputDir = await createValidPackage();
    await rm(path.join(outputDir, "chunks", "panel.js"));

    // A page that can be read is not a page that works.
    const result = await runVerifier(outputDir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing asset referenced by panel.html: chunks/panel.js");
  });

  it("rejects a page whose referenced bundle is empty", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(outputDir, "chunks/panel.js", "");

    const result = await runVerifier(outputDir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Asset referenced by panel.html is empty");
  });

  it("rejects a page with a base element before raw bundle references can mislead it", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><head><base href="/nested/"></head><body><script type="module" src="chunks/panel.js"></script></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Extension page declares a base element: panel.html");
  });

  it("does not reject an inert base inside template content", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><template><base href="/nested/"></template><script type="module" src="/chunks/panel.js"></script></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(0);
  });

  it("ignores inert noscript bundle-shaped markup", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><noscript><base href="/nested/"><script src="/chunks/noscript.js"></script><link rel="stylesheet" href="/assets/noscript.css"></noscript><script type="module" src="/chunks/panel.js"></script></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(0);
  });

  it("resolves parent-segment bundle references with browser URL semantics", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><head><link rel="stylesheet" href="../assets/parser.css"></head><body><script type="module" src="../chunks/panel.js"></script></body></html>',
    );
    await writePackageFile(outputDir, "assets/parser.css", "body {}\n");

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(0);
  });

  it("keeps browser URL resolution for clamped and nested-page references", () => {
    const clamped = packagedReferenceUrl("panel.html", "../../../chunks/panel.js");
    const nestedPage = packagedReferenceUrl("pages/panel.html", "../chunks/panel.js");

    expect(clamped).not.toBeNull();
    expect(nestedPage).not.toBeNull();
    expect(packagedReferencePath(clamped!)).toBe("chunks/panel.js");
    expect(packagedReferencePath(nestedPage!)).toBe("chunks/panel.js");
  });

  it("rejects an encoded-slash reference that would otherwise read outside the package", async () => {
    const outputDir = await createValidPackage();
    const escapedFilename = `escaped-${path.basename(outputDir)}.js`;
    const escapedFile = path.join(path.dirname(outputDir), escapedFilename);
    await writeFile(escapedFile, "export const outsidePackage = true;\n");
    await writePackageFile(
      outputDir,
      "panel.html",
      `<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><script type="module" src="%2e%2e%2f${escapedFilename}"></script></body></html>`,
    );

    try {
      const result = await runVerifier(outputDir);

      // Without containment, path.join reads the non-empty sibling and this passes.
      expect(result.status).toBe(1);
      expect(result.output).toContain("Packaged file escapes extension output directory");
      expect(result.output).toContain(`../${escapedFilename}`);
      expect(result.output).not.toContain("Missing asset referenced by panel.html");
    } finally {
      await rm(escapedFile, { force: true });
    }
  });

  it("rejects a whitespace-prefixed remote reference from its parsed URL", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(outputDir, "chunks/panel.css", "body {}\n");
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><head><link rel="stylesheet" href=" https://evil.example/chunks/panel.css"></head><body><script type="module" src="/chunks/panel.js"></script></body></html>',
    );

    const result = await runVerifier(outputDir);

    // The previous raw-string scheme guard misses leading ASCII whitespace.
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Extension page reference resolves outside the extension origin",
    );
  });

  it("rejects a well-formed remote reference from its parsed URL", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><head><link rel="stylesheet" href="https://evil.example/chunks/panel.css"></head><body><script type="module" src="/chunks/panel.js"></script></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Extension page reference resolves outside the extension origin",
    );
  });

  it("rejects a different extension host from its parsed URL", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><script type="module" src="chrome-extension://other-extension/chunks/panel.js"></script></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Extension page reference resolves outside the extension origin",
    );
  });

  it.each([
    ["an explicit sentinel host", "chrome-extension://pack/chunks/panel.js"],
    ["a scheme-relative sentinel host", "//pack/chunks/panel.js"],
  ])("rejects %s that only resolves locally by coincidence", async (_label, reference) => {
    // `chrome-extension://pack/` is a sentinel this verifier invents so relative
    // references have something to resolve against. Markup naming it outright is
    // indistinguishable after resolution, but the shipped package carries an
    // extension ID that Chrome will not substitute into an absolute URL -- so the
    // referenced chunk exists locally while the page cannot load it.
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      `<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><script type="module" src="${reference}"></script></body></html>`,
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Extension page reference is not page-relative");
  });

  it("names a malformed percent escape instead of throwing a raw URIError", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><script type="module" src="/chunks/%ZZ.js"></script></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Extension page reference is not a decodable path");
    expect(result.output).toContain("panel.html");
    // The operator must not be handed a bare decoder failure with no target.
    expect(result.output).not.toContain("URI malformed");
  });

  it("rejects a declarative shadow root whose contents it cannot inspect", async () => {
    // A template is inert only until it declares a shadow root. Chrome turns
    // `shadowrootmode` contents into an active shadow root and loads what they
    // reference, while querySelectorAll enters neither templates nor shadow roots.
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><div><template shadowrootmode="open"><link rel="stylesheet" href="/chunks/missing.css"></template></div></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Extension page declares a declarative shadow root");
  });

  it("still verifies active HTML beneath a foreign-namespace noscript", async () => {
    // `closest` matches on tag name across namespaces, so an SVG <noscript> is not
    // HTML's scripting fallback and must not mark the script beneath it inert.
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><svg><noscript><foreignObject><script src="/chunks/missing.js"></script></foreignObject></noscript></svg></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("chunks/missing.js");
  });

  it("names a syntactically invalid reference instead of skipping it", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><script type="module" src="http://["></script></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Extension page reference is not a valid URL");
    expect(result.output).toContain("panel.html");
    // An unparseable reference must not be silently skipped the way an empty one is.
    expect(result.output).not.toContain("ERR_INVALID_URL");
  });

  it.each([
    ["an empty reference", ""],
    ["a whitespace-only reference", "   "],
    ["a query-only reference", "?v=1"],
    ["a fragment-only reference", "#top"],
  ])("rejects %s that resolves to the page itself", async (_label, reference) => {
    // All four resolve to the containing page, so the verifier would read the HTML
    // as its own asset and pass, while Chrome cannot load that response as a script.
    // The raw scanner this replaced rejected them as missing.
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      `<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><script type="module" src="${reference}"></script></body></html>`,
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Extension page reference resolves to the page itself");
  });

  it("rejects an encoded spelling of the containing page", async () => {
    // `/pan%65l.html` stays encoded in `pathname` but decodes to `panel.html` for the
    // file lookup, so comparing raw pathnames let the HTML page through as a script.
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><script type="module" src="/pan%65l.html"></script></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Extension page reference resolves to the page itself");
  });

  it.each([
    ["dot segments from an encoded separator", "/chunks/%2e%2e%2fpanel.html"],
    ["plain dot segments", "/chunks/../panel.html"],
  ])("rejects %s that resolve to the page file", async (_label, reference) => {
    // Only `path.resolve` collapses these, so any comparison performed before the
    // lookup normalises sees a different path than the read does.
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      `<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><script type="module" src="${reference}"></script></body></html>`,
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Extension page reference resolves to the page itself");
  });

  it("names the outside-origin reason for a remote asset sharing the page pathname", async () => {
    // Without the origin in the comparison this reported a self-reference, which
    // sends a maintainer looking at the wrong thing.
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><script type="module" src="https://evil.example/panel.html"></script></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("resolves outside the extension origin");
    expect(result.output).not.toContain("resolves to the page itself");
  });

  it("accepts a bundle whose own name is percent-encoded", async () => {
    // The canonicalisation must not reject a legitimate encoded filename.
    const outputDir = await createValidPackage();
    await writePackageFile(outputDir, "chunks/pan el.js", "export default 1;\n");
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/pan%20el.js"></script></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(0);
  });

  it("still accepts a legitimate reference carrying a query and fragment", async () => {
    // The self-reference rule must not catch a real bundle that merely has a query.
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/panel.js?v=1#top"></script></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(0);
  });

  it("accepts a whitespace-normalized local reference", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src=" /chunks/panel.js"></script></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(0);
  });

  it("rejects an active srcdoc iframe before its nested bundle reference is missed", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><iframe srcdoc=\'&lt;script src="/chunks/missing.js"&gt;&lt;/script&gt;\'></iframe></body></html>',
    );

    const result = await runVerifier(outputDir);

    // Without the srcdoc guard, JSDOM only sees the outer script and passes.
    expect(result.status).toBe(1);
    expect(result.output).toContain("Extension page declares an iframe srcdoc: panel.html");
  });

  it("does not reject an ordinary iframe src", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(outputDir, "frames/help.html", "<!doctype html><title>Help</title>");
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><iframe src="/frames/help.html" title="Help"></iframe></body></html>',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).toBe(0);
  });

  it.each([
    [
      "a single-quoted script source",
      (reference: string) => `<script type='module' src='/${reference}'></script>`,
    ],
    [
      "an unquoted script source",
      (reference: string) => `<script type=module src=/${reference}></script>`,
    ],
    [
      "a stylesheet link whose rel follows href and contains multiple tokens",
      (reference: string) => `<link href=/${reference} rel="preload stylesheet">`,
    ],
    [
      "a greater-than sign in a quoted attribute before a script source",
      (reference: string) => `<script data-example=">" src="/${reference}"></script>`,
    ],
    [
      "a conventional comment containing script-shaped markup",
      (reference: string) =>
        `<!-- <script src="/chunks/comment-decoy.js"></script> --><script src="/${reference}"></script>`,
    ],
    [
      "script raw text containing script-shaped markup",
      (reference: string) =>
        `<script>const example = '<script src="/chunks/raw-script-decoy.js">';</script><script src="/${reference}"></script>`,
    ],
    [
      "style raw text containing script-shaped markup",
      (reference: string) =>
        `<style>example <script src="/chunks/raw-style-decoy.js"></style><script src="/${reference}"></script>`,
    ],
    [
      "a comment opener and greater-than sign inside a quoted attribute",
      (reference: string) =>
        `<script data-example="<!-- > not a comment -->" src="/${reference}"></script>`,
    ],
    [
      "textarea RCDATA containing script-shaped markup",
      (reference: string) =>
        `<textarea><script src="/chunks/textarea-decoy.js"></script></textarea><script src="/${reference}"></script>`,
    ],
    [
      "title RCDATA containing script-shaped markup",
      (reference: string) =>
        `<title><script src="/chunks/title-decoy.js"></script></title><script src="/${reference}"></script>`,
    ],
    [
      "a Chrome-compatible --!> comment close containing script-shaped markup",
      (reference: string) =>
        `<!-- <script src="/chunks/chrome-comment-decoy.js"></script> --!><script src="/${reference}"></script>`,
    ],
    [
      "a custom element whose name starts with script",
      (reference: string) =>
        `<script-widget src="/chunks/custom-element-decoy.js"></script-widget><script src="/${reference}"></script>`,
    ],
    [
      "case-insensitive HTML tag and attribute names",
      (reference: string) => `<SCRIPT SRC=/${reference}></SCRIPT>`,
    ],
    [
      "a non-stylesheet link next to an unquoted script bundle",
      (reference: string) =>
        `<link rel="icon" href="/chunks/ignored-icon.js"><script src=/${reference}></script>`,
    ],
    [
      "template content containing inert bundle-shaped markup",
      (reference: string) =>
        `<template><script src="/chunks/template-decoy.js"></script><link rel="stylesheet" href="/chunks/template.css"></template><script src="/${reference}"></script>`,
    ],
  ])("parses %s as a bundle reference", async (_label, markupForReference) => {
    const referencedBundle = "chunks/parser-reference.js";
    const missingBundle = "chunks/parser-missing.js";

    const validOutputDir = await createValidPackage();
    await writePackageFile(
      validOutputDir,
      "panel.html",
      pageWithBundleMarkup(markupForReference(referencedBundle)),
    );
    await writePackageFile(validOutputDir, referencedBundle, "export {};\n");

    const validResult = await runVerifier(validOutputDir);
    expect(validResult.status).toBe(0);
    expect(validResult.output).toContain("Pack WXT extension package verification passed.");

    const invalidOutputDir = await createValidPackage();
    await writePackageFile(
      invalidOutputDir,
      "panel.html",
      pageWithBundleMarkup(markupForReference(missingBundle)),
    );

    const invalidResult = await runVerifier(invalidOutputDir);
    expect(invalidResult.status).toBe(1);
    expect(invalidResult.output).toContain(
      `Missing asset referenced by panel.html: ${missingBundle}`,
    );
  });

  it("accepts packaged HTML without module preload hints", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script></body></html>',
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

  it("rejects a source-surface-only panel marker in a packaged artifact", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "assets/source-surfaces-panel.js",
      'const marker = "data-pack-source-surface";',
    );

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Source-surface marker data-pack-source-surface");
  });

  it.each([
    ["packaged verification", []],
    ["source-surfaces verification", ["--source-surfaces"]],
  ])("rejects the legacy marker during %s", async (_label, flags) => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "assets/legacy-source-surface.js",
      'const marker = "data-pack-alpha-surface";',
    );

    const result = await runVerifier(outputDir, {}, flags);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Legacy source-surface marker data-pack-alpha-surface");
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
    for (const page of ["offscreen.html", "options.html", "panel.html"]) {
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
    // Browser release verification drives a real browser, so the Playwright version
    // has to be exact rather than a range -- a floating minor would change the
    // browser under a release check that exists to be reproducible. Asserting the
    // exact pin, not a particular version: the literal `1.62.1` this replaced failed
    // every routine Playwright bump and made the upgrade look like the breakage.
    expect(packageJson.devDependencies["@playwright/test"]).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("keeps browser release verification fail-closed around the panel, scripts, network, and runtime errors", async () => {
    const script = await readFile(
      path.join(rootDir, "scripts", "verify-extension-browser.mjs"),
      "utf8",
    );

    expect(script).toContain("expectedContentScripts.length");
    expect(script).toContain("content-scripts/content.js");
    expect(script).not.toContain("content-scripts/gstr2b-capture-main.js");
    expect(script).toContain("Pack release must include only the approved content scripts.");
    expect(script).toContain("assertPanelPageLoads");
    expect(script).toContain("valid context state");
    expect(script).toContain("waitForFunction");
    // The popup asserted an alt-text wordmark and a compact width band. The panel
    // mark is decorative, so paint is proved through elementFromPoint plus a
    // decode check, and a side panel is user-resizable, so an upper width bound
    // would fail on a wide panel rather than catch anything.
    expect(script).toContain("markPainted");
    expect(script).toContain("naturalWidth");
    expect(script).toContain("shellRect.width < Math.min(300, panelState.viewportWidth - 32)");
    expect(script).toContain("https://services.gst.gov.in/services/auth/fowelcome");
    expect(script).toContain("await assertPanelSignInContext(context, extensionId)");
    expect(script).toContain('"sign-in context"');
    expect(script).toContain("readLoadedExtensionIdFromPreferences");
    expect(script).toContain("chrome-extension://${extensionId}/panel.html");
    expect(script).toContain('waitForEvent("serviceworker"');
    expect(script.indexOf('waitForEvent("serviceworker"')).toBeLessThan(
      script.indexOf("wakePage.goto(`chrome-extension://${extensionId}/panel.html`"),
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

describe("action-to-panel binding", () => {
  it("rejects a package whose side panel is not bound to the panel page", async () => {
    // Requiring panel.html to exist says nothing about whether the toolbar
    // action reaches it.
    const outputDir = await createValidPackage();
    const manifestPath = path.join(outputDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.side_panel;
    await writePackageFile(outputDir, "manifest.json", JSON.stringify(manifest));

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("side panel");
  });

  it("rejects a package whose action still declares a popup", async () => {
    // A default_popup takes precedence over the action's click event, so this
    // package opens the popup while advertising a side panel.
    const outputDir = await createValidPackage();
    const manifestPath = path.join(outputDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.action.default_popup = "popup.html";
    await writePackageFile(outputDir, "manifest.json", JSON.stringify(manifest));

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("must not declare a popup");
  });
});

describe("source-surfaces builds", () => {
  // A source-surfaces build is what live testing runs against, and it went unverified
  // entirely: pointed at that output the marker check refused it before any
  // other check ran, so a real leak -- the React development transform and an
  // absolute builder path -- sat in it undetected.
  it("requires the source-surfaces surface the build exists to carry", async () => {
    const outputDir = await createValidPackage();

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("this is not a source-surfaces build");
  });

  it("rejects a mistyped source-surfaces option instead of falling back to package verification", async () => {
    const outputDir = await createValidPackage();

    const result = await runVerifier(outputDir, {}, ["--aplha"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("usage: node scripts/verify-extension-package.mjs");
  });

  it("accepts a source-surfaces build whose panel actually loads the gated surface", async () => {
    const outputDir = await createValidPackage();
    await writeFile(
      path.join(outputDir, "chunks", "panel.js"),
      'import "./source-surface.js";\nexport default 1;\n',
      "utf8",
    );
    await writeFile(
      path.join(outputDir, "chunks", "source-surface.js"),
      renderedSourceSurface,
      "utf8",
    );

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.output).toContain("source-surfaces extension package verification passed");
    expect(result.status).toBe(0);
  });

  it("does not accept a marker constant that no JSX element renders", async () => {
    const outputDir = await createValidPackage();
    await writeFile(
      path.join(outputDir, "chunks", "panel.js"),
      'const surface = "data-pack-source-surface";\nexport default surface;\n',
      "utf8",
    );

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("reachable from the panel");
  });

  it("rejects TypeScript-only syntax in a marker-bearing emitted module", async () => {
    const outputDir = await createValidPackage();
    await writeFile(
      path.join(outputDir, "chunks", "panel.js"),
      'const surface: string = runtime.jsx("section", { "data-pack-source-surface": "full-fiscal-year" });\nexport default surface;\n',
      "utf8",
    );

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Malformed reachable module: chunks/panel.js");
  });

  it("traces a panel import graph when the source-surfaces output argument is relative", async () => {
    const outputDir = await createValidPackage();
    await writeFile(
      path.join(outputDir, "chunks", "panel.js"),
      'import "./source-surface.js";\nexport default 1;\n',
      "utf8",
    );
    await writeFile(
      path.join(outputDir, "chunks", "source-surface.js"),
      renderedSourceSurface,
      "utf8",
    );

    const result = await runVerifier(path.relative(rootDir, outputDir), {}, ["--source-surfaces"]);

    expect(result.status).toBe(0);
    expect(result.output).toContain("source-surfaces extension package verification passed");
  });

  it("refuses a marker no entry can reach", async () => {
    // A gated surface compiled out of the panel while a stale chunk still holds
    // the string would otherwise read as a correctly gated build.
    const outputDir = await createValidPackage();
    await writeFile(path.join(outputDir, "orphan-surface.js"), renderedSourceSurface, "utf8");

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("reachable from the panel");
  });

  it("does not mistake an import-shaped string for a panel dependency", async () => {
    const outputDir = await createValidPackage();
    await writeFile(
      path.join(outputDir, "chunks", "panel.js"),
      "const example = 'import \"./source-surface.js\"';\nexport default example;\n",
      "utf8",
    );
    await writeFile(
      path.join(outputDir, "chunks", "source-surface.js"),
      renderedSourceSurface,
      "utf8",
    );

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("reachable from the panel");
  });

  it("does not mistake a commented panel script for a loaded entry", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><!-- <script type="module" src="/chunks/source-surface.js"></script> --></body></html>',
    );
    await writePackageFile(
      outputDir,
      "chunks/source-surface.js",
      'const surface = "data-pack-source-surface";\nexport default surface;\n',
    );

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("reachable from the panel");
  });

  it("does not mistake an inert panel script for a module entry", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script><script type="application/json" src="/chunks/source-surface.js"></script></body></html>',
    );
    await writePackageFile(
      outputDir,
      "chunks/source-surface.js",
      'const surface = "data-pack-source-surface";\nexport default surface;\n',
    );

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("reachable from the panel");
  });

  it.each([
    [
      "a noscript panel tag",
      '<noscript><script type="module" src="/chunks/source-surface.js"></script></noscript>',
      "reachable from the panel",
    ],
    [
      "an SVG script element",
      '<svg><script type="module" src="/chunks/source-surface.js"></script></svg>',
      "reachable from the panel",
    ],
    [
      "a document base",
      '<base href="https://example.invalid/"><script type="module" src="/chunks/source-surface.js"></script>',
      "Extension page declares a base element: panel.html",
    ],
  ])("does not use %s as a panel module entry", async (_label, inertMarkup, expectedMessage) => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      `<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script>${inertMarkup}</body></html>`,
    );
    await writePackageFile(
      outputDir,
      "chunks/source-surface.js",
      'const surface = "data-pack-source-surface";\nexport default surface;\n',
    );

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(expectedMessage);
  });

  it("does not treat protocol-relative imports as packaged module dependencies", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "chunks/panel.js",
      'import "//chunks/source-surface.js";\nexport default 1;\n',
    );
    await writePackageFile(
      outputDir,
      "chunks/source-surface.js",
      'const surface = "data-pack-source-surface";\nexport default surface;\n',
    );

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Unresolved static import "//chunks/source-surface.js"');
  });

  it("does not resolve a module fragment as a packaged filename", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "chunks/panel.js",
      'import "./source-surface#proof.js";\nexport default 1;\n',
    );
    await writePackageFile(outputDir, "chunks/source-surface#proof.js", renderedSourceSurface);

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Unresolved static import "./source-surface#proof.js"');
  });

  it("rejects a non-JavaScript module entry before its marker can count", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "panel.html",
      '<!doctype html><html><body><script type="module" src="/chunks/source-surface.json"></script></body></html>',
    );
    await writePackageFile(outputDir, "chunks/source-surface.json", renderedSourceSurface);

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Non-JavaScript module resource: chunks/source-surface.json");
  });

  it("does not follow a static import recovered from malformed JavaScript", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(
      outputDir,
      "chunks/panel.js",
      'import "./source-surface.js";\nconst broken = ;\n',
    );
    await writePackageFile(
      outputDir,
      "chunks/source-surface.js",
      'const surface = "data-pack-source-surface";\nexport default surface;\n',
    );

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Malformed reachable module: chunks/panel.js");
  });

  it("rejects a malformed reachable module even when it contains the source-surfaces marker", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(outputDir, "chunks/panel.js", renderedSourceSurface);

    const validResult = await runVerifier(outputDir, {}, ["--source-surfaces"]);
    expect(validResult.status).toBe(0);

    await writePackageFile(
      outputDir,
      "chunks/panel.js",
      'const surface = "data-pack-source-surface";\nconst broken = ;\n',
    );
    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Malformed reachable module: chunks/panel.js");
  });

  it("rejects a marker-bearing module whose static dependency is unresolved", async () => {
    const outputDir = await createValidPackage();
    await writePackageFile(outputDir, "chunks/panel.js", renderedSourceSurface);

    const validResult = await runVerifier(outputDir, {}, ["--source-surfaces"]);
    expect(validResult.status).toBe(0);

    await writePackageFile(
      outputDir,
      "chunks/panel.js",
      'import "./missing.js";\nconst surface = "data-pack-source-surface";\nexport default surface;\n',
    );
    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Unresolved static import "./missing.js" from chunks/panel.js');
  });

  it("refuses a rendered source-surfaces marker only another extension page can reach", async () => {
    const outputDir = await createValidPackage();
    // The marker is rendered in offscreen.html, but no panel module can reach it.
    // This names the package-verifier boundary directly rather than relying on
    // the separate unrendered-marker guard.
    await writeFile(
      path.join(outputDir, "chunks", "offscreen.js"),
      'import "./source-surface.js";\nexport default 1;\n',
      "utf8",
    );
    await writeFile(
      path.join(outputDir, "chunks", "source-surface.js"),
      renderedSourceSurface,
      "utf8",
    );

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("reachable from the panel");
  });

  it("refuses the React development transform in a source-surfaces build", async () => {
    // Names the transform rather than inferring it from a leaked home path: a
    // build made under a directory the redaction policy does not recognise
    // leaks nothing recognisable and would otherwise pass.
    const outputDir = await createValidPackage();
    await writeFile(
      path.join(outputDir, "chunks", "panel.js"),
      'import "./source-surface.js";\nconst jsxDEV = "react/jsx-dev-runtime";\nexport default jsxDEV;\n',
      "utf8",
    );
    await writeFile(
      path.join(outputDir, "chunks", "source-surface.js"),
      'const surface = "data-pack-source-surface";\nexport default surface;\n',
      "utf8",
    );

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("this is a development build");
  });

  it("still rejects a builder path in a source-surfaces build", async () => {
    // The regression this mode exists for: a development-mode source-surfaces build
    // inlines an absolute source path containing the builder's home
    // directory. Every other check applies to a source-surfaces build unchanged.
    const outputDir = await createValidPackage();
    await writeFile(
      path.join(outputDir, "source-surface.js"),
      'const surface = "data-pack-source-surface";\nexport default surface;\n',
      "utf8",
    );
    await writeFile(
      path.join(outputDir, "leaky.js"),
      'const jsxFile = "/Users/someone/dev/pack/src/entrypoints/options/main.tsx";\nexport default jsxFile;\n',
      "utf8",
    );

    const result = await runVerifier(outputDir, {}, ["--source-surfaces"]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("home-path");
  });

  it("keeps refusing the marker in a packaged build", async () => {
    const outputDir = await createValidPackage();
    await writeFile(
      path.join(outputDir, "source-surface.js"),
      'const surface = "data-pack-source-surface";\nexport default surface;\n',
      "utf8",
    );

    const result = await runVerifier(outputDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Source-surface marker");
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
      "Beta: Save filed GSTR-1 and GSTR-3B returns and auto-drafted GSTR-2B statements locally. No account or stored portal credentials.",
    homepage_url: "https://pack.complyeaze.com/gst",
    permissions: ["downloads", "offscreen", "scripting", "sidePanel", "storage"],
    side_panel: { default_path: "panel.html" },
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
  for (const page of ["offscreen.html", "options.html", "panel.html"]) {
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

function pageWithBundleMarkup(markup: string) {
  return `<!doctype html><html><body><script type="module" src="/chunks/panel.js"></script>${markup}</body></html>`;
}

async function runVerifier(
  outputDir: string,
  env: NodeJS.ProcessEnv = {},
  flags: readonly string[] = [],
): Promise<{ output: string; status: number }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/verify-extension-package.mjs", ...flags, outputDir],
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
