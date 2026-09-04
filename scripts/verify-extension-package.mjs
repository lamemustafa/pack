import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const args = process.argv.slice(2);
// A source-surfaces build is a real distributable that live testing runs against, so it
// needs every check here -- the home-path and telemetry checks caught a genuine
// leak in one. It differs from a packaged build in exactly one respect: the
// source-surface marker must be present rather than absent. Without this flag
// the marker check refuses the source-surfaces output before anything else is inspected,
// which left that build unverified entirely.
const flags = args.filter((arg) => arg.startsWith("--"));
const outputDirectories = args.filter((arg) => !arg.startsWith("--"));
if (flags.some((flag) => flag !== "--source-surfaces") || outputDirectories.length !== 1) {
  throw new Error(
    "usage: node scripts/verify-extension-package.mjs [--source-surfaces] <extension-output-dir>",
  );
}
const sourceSurfacesMode = flags.includes("--source-surfaces");
// JSDOM is only evidence machinery for the source-surface panel reachability
// graph. Loading it for ordinary packaged-build verification makes every
// short-lived verifier invocation pay its initialization cost.
const JSDOM = sourceSurfacesMode ? (await import("jsdom")).JSDOM : null;
const outputDir = path.resolve(outputDirectories[0]);
let sawSourceSurfaceMarker = false;

/**
 * Every file the panel entry can actually load, followed through static imports.
 * Source-surface evidence is restricted to this set: a marker sitting in another page's
 * bundle proves nothing about the panel surface, and a marker in a chunk nothing
 * imports proves only that a string exists on disk.
 */
async function reachableFromPanelHtml(dir) {
  const files = await listFiles(dir);
  const queue = [];
  const panelEntry = path.join(dir, "panel.html");
  if (files.includes(panelEntry)) {
    const html = await readFile(panelEntry, "utf8");
    for (const specifier of panelModuleScriptSpecifiers(html)) {
      queue.push(resolveOutputSpecifier(dir, panelEntry, specifier));
    }
  }
  const reachable = new Set();
  while (queue.length > 0) {
    const next = queue.pop();
    if (next === null || reachable.has(next) || !files.includes(next)) continue;
    reachable.add(next);
    if (!/\.js$/.test(next)) {
      throw new Error(`Non-JavaScript module resource: ${path.relative(dir, next)}`);
    }
    const contents = await readFile(next, "utf8");
    const specifiers = staticModuleSpecifiers(next, contents);
    if (specifiers === null) {
      throw new Error(`Malformed reachable module: ${path.relative(dir, next)}`);
    }
    for (const specifier of specifiers) {
      const dependency = resolveOutputSpecifier(dir, next, specifier);
      if (!/\.js$/.test(dependency ?? "") || dependency === null || !files.includes(dependency)) {
        throw new Error(
          `Unresolved static import ${JSON.stringify(specifier)} from ${path.relative(dir, next)}`,
        );
      }
      queue.push(dependency);
    }
  }
  return reachable;
}

function panelModuleScriptSpecifiers(markup) {
  if (JSDOM === null) return [];
  const dom = new JSDOM(markup, { runScripts: "outside-only" });
  try {
    // Package pages never need a document base. Its presence makes the raw
    // source attributes insufficient reachability evidence, so fail closed.
    if (dom.window.document.querySelector("base")) return [];
    return [...dom.window.document.querySelectorAll('script[type="module"][src]')].flatMap(
      (script) => {
        if (
          script.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
          script.closest("noscript") !== null
        ) {
          return [];
        }
        const specifier = script.getAttribute("src");
        return specifier ? [specifier] : [];
      },
    );
  } finally {
    dom.window.close();
  }
}

function staticModuleSpecifiers(fileName, contents) {
  const source = ts.createSourceFile(
    fileName,
    contents,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const transpiled = ts.transpileModule(contents, {
    fileName,
    reportDiagnostics: true,
  });
  if (
    source.parseDiagnostics.length > 0 ||
    transpiled.diagnostics?.some(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    )
  ) {
    return null;
  }
  return source.statements.flatMap((statement) => {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [statement.moduleSpecifier.text];
    }
    return [];
  });
}

function hasRenderedSourceSurfaceMarker(fileName, contents, marker) {
  const source = ts.createSourceFile(
    fileName,
    contents,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  if (source.parseDiagnostics.length > 0) return false;
  let rendered = false;
  const jsxFactoryName = (expression) => {
    if (ts.isParenthesizedExpression(expression)) return jsxFactoryName(expression.expression);
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.CommaToken
    ) {
      return jsxFactoryName(expression.right);
    }
    return ts.isPropertyAccessExpression(expression) ? expression.name.text : null;
  };
  const visit = (node) => {
    if (rendered) return;
    if (ts.isCallExpression(node) && ["jsx", "jsxs"].includes(jsxFactoryName(node.expression))) {
      const properties = node.arguments[1];
      if (properties !== undefined && ts.isObjectLiteralExpression(properties)) {
        rendered = properties.properties.some(
          (property) =>
            ts.isPropertyAssignment(property) &&
            ((ts.isStringLiteral(property.name) && property.name.text === marker) ||
              (ts.isIdentifier(property.name) && property.name.text === marker)),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return rendered;
}

function resolveOutputSpecifier(dir, fromFile, specifier) {
  if (
    /^[a-z]+:/i.test(specifier) ||
    specifier.startsWith("//") ||
    specifier.includes("#") ||
    specifier.includes("?") ||
    (!specifier.startsWith("/") && !specifier.startsWith("./") && !specifier.startsWith("../"))
  ) {
    return null;
  }
  return specifier.startsWith("/")
    ? path.join(dir, specifier.slice(1))
    : path.resolve(path.dirname(fromFile), specifier);
}

const reachableFiles = sourceSurfacesMode ? await reachableFromPanelHtml(outputDir) : new Set();

const harnessPolicyPath =
  process.env.PACK_HARNESS_POLICY_PATH ??
  path.join(process.cwd(), "policies", "agent-harness-policy.snapshot.json");
const harnessPolicy = JSON.parse(await readFile(harnessPolicyPath, "utf8"));
validateHarnessPolicySnapshot(harnessPolicy);
const harnessRedactionPatterns = (harnessPolicy.policy?.redaction?.patterns ?? []).map((entry) => ({
  id: entry.id,
  pattern: new RegExp(entry.pattern, "gi"),
}));
const harnessPackageLeakPatterns = harnessRedactionPatterns.filter(({ id }) => {
  return id !== "gst-url";
});
const pathfulGstPortalPattern =
  /https:\/\/(?:www|services|return|gstr2b)\.gst\.gov\.in\/(?!\*)(?:[^\s"']+)/i;
const allowedPathfulGstPortalUrls = ["https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary"];

const manifestPath = path.join(outputDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const expectedName = "ComplyEaze Pack: GST Return Downloader";
const expectedShortName = "ComplyEaze Pack";
const expectedDescription =
  "Download filed GSTR-1 and GSTR-3B returns and auto-drafted GSTR-2B statements locally. No account or stored portal credentials.";
const expectedHomepageUrl = "https://pack.complyeaze.com/gst";
const expectedIcons = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png",
};
// Every page the built extension is expected to serve. A build that silently dropped one
// of these still produced a loadable extension with a dead surface behind it, and nothing
// here noticed: offscreen.html was the only page asserted.
const expectedPackagedPages = ["offscreen.html", "options.html", "panel.html"];
const expectedPackagedBrandAssets = [
  "favicon.ico",
  "icons/icon-256.png",
  "icons/icon-512.png",
  // Referenced at runtime by a Pack page. Absent, the surface renders a broken image.
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
const expectedPermissions = ["downloads", "offscreen", "scripting", "sidePanel", "storage"];
const expectedHostPermissions = [
  "https://www.gst.gov.in/*",
  "https://services.gst.gov.in/*",
  "https://return.gst.gov.in/*",
  "https://gstr2b.gst.gov.in/*",
];

const forbiddenPermissions = new Set([
  "cookies",
  "debugger",
  "history",
  "webRequest",
  "webRequestBlocking",
  "nativeMessaging",
  "identity",
  "unlimitedStorage",
  "tabs",
  "alarms",
  "clipboardRead",
  "clipboardWrite",
]);

if (manifest.name !== expectedName) throw new Error(`Unexpected manifest name: ${manifest.name}`);
if (manifest.short_name !== expectedShortName) {
  throw new Error(`Unexpected manifest short_name: ${manifest.short_name}`);
}
if (manifest.description !== expectedDescription) {
  throw new Error(`Unexpected manifest description: ${manifest.description}`);
}
if (manifest.homepage_url !== expectedHomepageUrl) {
  throw new Error(`Unexpected manifest homepage_url: ${manifest.homepage_url}`);
}
if (manifest.action?.default_title !== expectedShortName) {
  throw new Error(`Unexpected action title: ${manifest.action?.default_title}`);
}
if (JSON.stringify(manifest.action?.default_icon ?? {}) !== JSON.stringify(expectedIcons)) {
  throw new Error("Pack action default_icon must match extension icons.");
}

for (const [size, iconPath] of Object.entries(expectedIcons)) {
  if (manifest.icons?.[size] !== iconPath) {
    throw new Error(`Missing required ${size}px icon: ${iconPath}`);
  }
  await requirePackagedFile(iconPath, `required ${size}px icon`);
}

for (const assetPath of expectedPackagedBrandAssets) {
  const bytes = await requirePackagedFile(assetPath, "required brand asset");
  // Present is not the same as usable. A zero-byte mark passes an existence
  // check and every scan that follows, while the surface referencing it renders
  // nothing -- the same distinction the page and bundle checks already make.
  if (bytes.byteLength === 0) {
    throw new Error(`Required brand asset is empty: ${assetPath}`);
  }
}

for (const page of expectedPackagedPages) {
  const html = await requirePackagedFile(page, "required extension page");
  const markup = html.toString("utf8");
  // An empty page references nothing, so the bundle check below would pass it
  // silently. A page that renders nothing is a dead surface, not a valid one.
  if (markup.trim().length === 0) {
    throw new Error(`Required extension page is empty: ${page}`);
  }
  await requireReferencedBundles(page, markup);
}

// A packaged panel page proves nothing about whether the toolbar action reaches
// it. `default_popup` takes precedence over the action's click event, so a
// package carrying both a side panel and a popup opens the popup, and one with
// neither has a toolbar button that does nothing. Both clear a check that only
// asserts the page is present.
if (manifest.side_panel?.default_path !== "panel.html") {
  throw new Error(
    `Extension must bind the side panel to panel.html: ${manifest.side_panel?.default_path ?? "absent"}`,
  );
}
if (manifest.action?.default_popup !== undefined) {
  throw new Error(`Extension action must not declare a popup: ${manifest.action.default_popup}`);
}

for (const permission of expectedPermissions) {
  if (!manifest.permissions?.includes(permission))
    throw new Error(`Missing required permission: ${permission}`);
}

for (const permission of manifest.permissions ?? []) {
  if (!expectedPermissions.includes(permission))
    throw new Error(`Unexpected permission present: ${permission}`);
  if (forbiddenPermissions.has(permission))
    throw new Error(`Forbidden permission present: ${permission}`);
}

if ((manifest.optional_permissions ?? []).length > 0) {
  throw new Error("Pack must not expose optional permissions.");
}

if ((manifest.host_permissions ?? []).length !== expectedHostPermissions.length) {
  throw new Error("Pack V0 must keep the exact GST host allow-list.");
}

for (const host of manifest.host_permissions ?? []) {
  if (!expectedHostPermissions.includes(host)) {
    throw new Error(`Unexpected host permission: ${host}`);
  }
}

if (manifest.externally_connectable)
  throw new Error("Pack V0 must not expose externally_connectable.");

const extensionPagesCsp = manifest.content_security_policy?.extension_pages ?? "";
if (!extensionPagesCsp.includes("script-src 'self'")) {
  throw new Error("Extension CSP must restrict scripts to 'self'.");
}
if (!extensionPagesCsp.includes("object-src 'self'")) {
  throw new Error("Extension CSP must restrict objects to 'self'.");
}
if (extensionPagesCsp.includes("unsafe-eval")) {
  throw new Error("Extension CSP must not allow unsafe-eval.");
}

const forbiddenBuiltArtifactPatterns = [
  /\beval\s*\(/,
  /\bnew\s+Function\b/,
  /https?:\/\/[^"')\s]+\.js\b/,
  /importScripts\s*\(/,
];

const forbiddenTelemetryPatterns = [
  {
    label: "posthog-js",
    pattern: /\bposthog-js\b|@posthog\/(?:browser|core)|api\.posthog\.com/i,
  },
  {
    label: "sentry.io",
    pattern: /@sentry\/(?:browser|react|core)|\bSentry\.init\b|sentry\.io/i,
  },
  {
    label: "LogRocket",
    pattern: /\bLogRocket\b|\blogrocket\b|cdn\.logrocket\.io|api\.logrocket\.com/i,
  },
  {
    label: "FullStory",
    pattern: /\bFullStory\b|\bFS\.identify\b|fullstory\.com|edge\.fullstory\.com/i,
  },
  {
    label: "Segment",
    pattern: /\banalytics\.load\b|@segment\/analytics|cdn\.segment\.com|api\.segment\.io/i,
  },
  {
    label: "Mixpanel",
    pattern: /\bmixpanel\b|api\.mixpanel\.com|cdn\.mxpnl\.com/i,
  },
  {
    label: "Amplitude",
    pattern: /\bamplitude-js\b|@amplitude\/analytics-browser|api\.amplitude\.com/i,
  },
  {
    label: "Google Analytics",
    pattern: /\bgtag\s*\(|\bdataLayer\b|google-analytics\.com|googletagmanager\.com/i,
  },
  {
    label: "Microsoft Clarity",
    pattern: /\bclarity\s*\(|clarity\.ms/i,
  },
  {
    label: "Hotjar",
    pattern: /\bhotjar\b|static\.hotjar\.com|script\.hotjar\.com/i,
  },
  {
    label: "Datadog RUM",
    pattern: /@datadog\/browser-rum|datadoghq-browser-agent|browser-intake-datadoghq/i,
  },
  {
    label: "New Relic Browser",
    pattern: /newrelic\.com\/nr-|js-agent\.newrelic\.com|NREUM/i,
  },
  {
    label: "Bugsnag",
    pattern: /@bugsnag\/browser|notify\.bugsnag\.com/i,
  },
];

const forbiddenBuiltSvgPatterns = [
  /<script\b/i,
  /\son[a-z]+\s*=/i,
  /\b(?:href|xlink:href)\s*=\s*["'](?:https?:|data:|javascript:)/i,
  /url\(\s*["']?(?:https?:|data:|javascript:)/i,
];

const forbiddenPackSourcePatterns = [
  /session_token/i,
  /captcha_response/i,
  /\bpassword\b/i,
  /\botp_value\b/i,
  /\bcookie_jar\b/i,
  /\bcredential_store\b/i,
  /\bapi_secret\b/i,
  /\bindexedDB\b/i,
  /\bcaches\.open\s*\(/i,
];

// Source-surface flows are permitted only in WXT's `source-surfaces` mode. The JSX
// marker is removed from a production bundle by Vite's compile-time mode
// replacement; finding it in a release package means the exclusion failed.
const forbiddenSourceSurfaceMarkers = ["data-pack-source-surface"];
// Artifacts built before the mode rename carry this marker. They must never be
// treated as a packaged build, and source-surfaces verification must accept
// only the current marker contract.
const legacySourceSurfaceMarkers = ["data-pack-alpha-surface"];
// A distributable is never a development build, whatever mode produced it. The
// home-path check catches one symptom of the React development transform, but
// only when the builder's path matches a known home pattern -- a build made
// under `/workspace` or a CI checkout leaks nothing recognisable and would pass
// while still shipping the development runtime. These name the transform
// itself.
const forbiddenDevelopmentRuntimeMarkers = [
  "jsxDEV",
  "react/jsx-dev-runtime",
  "react-jsx-dev-runtime",
];
const forbiddenRawArtifactHandoffPatterns = [
  {
    label: "raw artifact dataUrl postMessage",
    pattern: /postMessage\s*\([\s\S]{0,800}\bdataUrl\b/i,
  },
  {
    label: "raw artifact dataUrl runtime sendMessage",
    pattern: /runtime\.sendMessage\s*\([\s\S]{0,800}\bdataUrl\b/i,
  },
];

for (const file of await listFiles(outputDir)) {
  assertNoHarnessPolicyLeaks(path.relative(outputDir, file), file);
  if (!/\.(js|json|html|css|svg)$/.test(file)) continue;
  const contents = await readFile(file, "utf8");
  if (/\.html$/.test(file)) {
    for (const linkTag of contents.matchAll(/<link\b[^>]*>/gi)) {
      const relAttribute = linkTag[0].match(/\srel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
      const relValue = relAttribute?.slice(1).find((value) => value !== undefined) ?? "";
      if (relValue.toLowerCase().split(/\s+/).includes("modulepreload")) {
        throw new Error(`Module preload hint in ${path.relative(outputDir, file)}`);
      }
    }
  }
  if (/\.(js|json|html|css)$/.test(file)) {
    for (const pattern of forbiddenBuiltArtifactPatterns) {
      if (pattern.test(contents))
        throw new Error(`Forbidden pattern ${pattern} in ${path.relative(process.cwd(), file)}`);
    }
    assertNoForbiddenTelemetry(contents, file);
    assertNoHarnessPolicyLeaks(contents, file);
    assertNoPathfulGstPortalUrl(contents, file);
    for (const marker of forbiddenDevelopmentRuntimeMarkers) {
      if (contents.includes(marker)) {
        throw new Error(
          `React development marker ${marker} in ${path.relative(process.cwd(), file)}; this is a development build.`,
        );
      }
    }
    for (const marker of legacySourceSurfaceMarkers) {
      if (contents.includes(marker)) {
        throw new Error(
          `Legacy source-surface marker ${marker} found in ${path.relative(process.cwd(), file)}`,
        );
      }
    }
    for (const marker of forbiddenSourceSurfaceMarkers) {
      if (!contents.includes(marker)) continue;
      if (!sourceSurfacesMode) {
        throw new Error(
          `Source-surface marker ${marker} found in ${path.relative(process.cwd(), file)}`,
        );
      }
      if (reachableFiles.has(file) && hasRenderedSourceSurfaceMarker(file, contents, marker)) {
        sawSourceSurfaceMarker = true;
      }
    }
  }
  if (/\.svg$/.test(file)) {
    for (const pattern of forbiddenBuiltSvgPatterns) {
      if (pattern.test(contents)) {
        throw new Error(
          `Forbidden SVG pattern ${pattern} in ${path.relative(process.cwd(), file)}`,
        );
      }
    }
    assertNoHarnessPolicyLeaks(contents, file);
    assertNoPathfulGstPortalUrl(contents, file);
  }
}

for (const file of await listFiles(path.join(process.cwd(), "src"))) {
  assertNoHarnessPolicyLeaks(path.relative(process.cwd(), file), file);
  if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
  const contents = await readFile(file, "utf8");
  for (const pattern of forbiddenPackSourcePatterns) {
    if (pattern.test(contents))
      throw new Error(
        `Sensitive Pack source marker ${pattern} in ${path.relative(process.cwd(), file)}`,
      );
  }
  for (const { label, pattern } of forbiddenRawArtifactHandoffPatterns) {
    const relativeSourcePath = path.relative(process.cwd(), file);
    if (relativeSourcePath === "src/background/offscreen-blob-url.ts") continue;
    if (pattern.test(contents)) {
      throw new Error(`${label} in ${path.relative(process.cwd(), file)}`);
    }
  }
  assertNoForbiddenTelemetry(contents, file);
}

if (sourceSurfacesMode && !sawSourceSurfaceMarker) {
  // A silently gate-less source-surfaces build is the failure this mode exists to
  // catch: it would pass every other check while shipping none of the surface
  // the build was made to exercise.
  throw new Error(
    `No source-surface marker reachable from the panel in ${path.relative(process.cwd(), outputDir)}; this is not a source-surfaces build.`,
  );
}
console.log(
  sourceSurfacesMode
    ? "Pack WXT source-surfaces extension package verification passed."
    : "Pack WXT extension package verification passed.",
);

/** Reads a packaged file, or fails naming the file rather than crashing with a raw ENOENT. */

// A page that can be read is not a page that works: every local script and
// stylesheet it references must also be present and non-empty. Without this, a
// build that emitted the HTML but dropped its chunk passed verification.
async function requireReferencedBundles(page, html) {
  const references = [
    ...html.matchAll(/<script[^>]+src="([^"]+)"/g),
    ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g),
  ].map((match) => match[1]);

  for (const reference of references) {
    if (/^[a-z]+:/i.test(reference) || reference.startsWith("//")) {
      throw new Error(`Extension page references a remote asset: ${page} -> ${reference}`);
    }
    const relative = reference.replace(/^\//, "").split(/[?#]/)[0];
    if (!relative) continue;
    const bytes = await requirePackagedFile(relative, `asset referenced by ${page}`);
    if (bytes.byteLength === 0) {
      throw new Error(`Asset referenced by ${page} is empty: ${relative}`);
    }
  }
}

async function requirePackagedFile(relativePath, reason) {
  try {
    return await readFile(path.join(outputDir, relativePath));
  } catch (error) {
    throw new Error(`Missing ${reason}: ${relativePath} (${error?.code ?? error?.message})`);
  }
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(fullPath) : fullPath;
    }),
  );
  return files.flat();
}

function assertNoForbiddenTelemetry(contents, file) {
  for (const { label, pattern } of forbiddenTelemetryPatterns) {
    if (pattern.test(contents)) {
      throw new Error(
        `Forbidden telemetry marker ${label} in ${path.relative(process.cwd(), file)}`,
      );
    }
  }
}

function assertNoHarnessPolicyLeaks(contents, file) {
  for (const { id, pattern } of harnessPackageLeakPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(contents)) {
      throw new Error(
        `Sensitive marker ${id} from agent-harness-policy.snapshot.json in ${path.relative(
          process.cwd(),
          file,
        )}`,
      );
    }
  }
}

function assertNoPathfulGstPortalUrl(contents, file) {
  let inspectedContents = contents;
  for (const allowedUrl of allowedPathfulGstPortalUrls) {
    inspectedContents = inspectedContents.split(allowedUrl).join("");
  }
  if (pathfulGstPortalPattern.test(inspectedContents)) {
    throw new Error(`Pathful GST Portal URL in ${path.relative(process.cwd(), file)}`);
  }
}

function validateHarnessPolicySnapshot(snapshot) {
  const manifest = snapshot.manifest ?? {};
  const requiredManifestFields = [
    "policySchemaVersion",
    "policyVersion",
    "sourceRepository",
    "sourceCommit",
    "canonicalPolicySha256",
    "generatorVersion",
  ];
  for (const field of requiredManifestFields) {
    if (!manifest[field]) {
      throw new Error(`Invalid harness policy snapshot: missing manifest.${field}`);
    }
  }
  if (!/^[a-f0-9]{40}$/i.test(manifest.sourceCommit)) {
    throw new Error("Invalid harness policy snapshot: sourceCommit must be a 40-character git SHA");
  }
  if (!/^sha256:[a-f0-9]{64}$/i.test(manifest.canonicalPolicySha256)) {
    throw new Error(
      "Invalid harness policy snapshot: canonicalPolicySha256 must be a sha256 digest",
    );
  }

  const requiredPatternIds = new Set([
    "gstin",
    "pan",
    "openai-secret",
    "cookie-header",
    "home-path",
    "gst-url",
  ]);
  const patterns = snapshot.policy?.redaction?.patterns ?? [];
  for (const patternId of requiredPatternIds) {
    if (!patterns.some((entry) => entry.id === patternId)) {
      throw new Error(`Invalid harness policy snapshot: missing redaction pattern ${patternId}`);
    }
  }
  for (const entry of patterns) {
    new RegExp(entry.pattern, "gi");
  }
  validatePolicyPatternSamples(patterns);
  validateCanonicalPolicyDigest(snapshot);
}

function validateCanonicalPolicyDigest(snapshot) {
  const expected = snapshot.manifest?.canonicalPolicySha256;
  const actual = `sha256:${createHash("sha256")
    .update(stableJson(snapshot.policy ?? {}))
    .digest("hex")}`;
  if (expected !== actual) {
    throw new Error(
      `Invalid harness policy snapshot: canonicalPolicySha256 does not match snapshot.policy; expected ${actual}.`,
    );
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function validatePolicyPatternSamples(patterns) {
  const samples = new Map([
    ["gstin", ["00XXXXX0000X0Z0"]],
    ["pan", ["XXXXX0000X"]],
    ["openai-secret", ["sk-proj-example_secret"]],
    ["cookie-header", ["cookie: SID=secret-value", "authorization: Bearer value"]],
    [
      "home-path",
      [
        "/Users/example/Downloads/return.pdf",
        "/home/example/Downloads/return.pdf",
        "C:\\Users\\example\\Downloads\\return.pdf",
      ],
    ],
    [
      "gst-url",
      [
        "https://services.gst.gov.in/services/auth/efiledreturns",
        "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
      ],
    ],
  ]);

  for (const [patternId, values] of samples) {
    const entry = patterns.find((candidate) => candidate.id === patternId);
    const pattern = new RegExp(entry.pattern, "i");
    for (const value of values) {
      if (!pattern.test(value)) {
        throw new Error(
          `Invalid harness policy snapshot: redaction pattern ${patternId} missed ${value}`,
        );
      }
    }
  }
}
