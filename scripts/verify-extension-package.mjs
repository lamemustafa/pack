import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const outputDir = process.argv[2];
if (!outputDir)
  throw new Error("usage: node scripts/verify-extension-package.mjs <extension-output-dir>");

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
  "Alpha: locally download GSTR-1/GSTR-3B files; private GSTR-2B downloads are source-build experimental.";
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
const expectedPackagedPages = ["offscreen.html", "options.html", "panel.html", "popup.html"];
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
const expectedPermissions = ["downloads", "offscreen", "scripting", "storage"];
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

console.log("Pack WXT extension package verification passed.");

/** Reads a packaged file, or fails naming the file rather than crashing with a raw ENOENT. */

// A page that can be read is not a page that works: every local script and
// stylesheet it references must also be present and non-empty. Without this, a
// build that emitted the HTML but dropped its chunk passed verification.
async function requireReferencedBundles(page, html) {
  for (const reference of referencedAssetPaths(html)) {
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

// Reference extraction reads attributes rather than matching one composed
// shape. The regexes this replaces accepted only double-quoted attributes and
// required a stylesheet's `rel` to precede its `href` -- which is what the
// current bundler emits, so the gate was verified against the emitter's
// formatting habits rather than against HTML. A bundler upgrade that changed
// quoting would have turned this check into a no-op, and a no-op check reports
// success: a page referencing a bundle the package does not contain would have
// shipped as a passing build.
function referencedAssetPaths(html) {
  const references = [];
  html = withoutInertMarkup(html);
  for (const attributes of htmlTags(html, "script")) {
    const src = attributes.get("src");
    if (src) references.push(src);
  }
  for (const attributes of htmlTags(html, "link")) {
    // `rel` is a space-separated token list, and only a stylesheet is a bundle.
    // An icon or a manifest link is not one, so widening this to every `href`
    // would fail the build on something legitimate.
    const rel = attributes.get("rel") ?? "";
    if (!rel.split(/\s+/).some((token) => token.toLowerCase() === "stylesheet")) continue;
    const href = attributes.get("href");
    if (href) references.push(href);
  }
  return references;
}

/**
 * Blanks out comment and raw-text bodies, preserving length so nothing shifts.
 *
 * Scanning raw markup treats a commented-out `<script src=...>` as a live
 * reference, so a page carrying a disabled tag fails the build for an asset it
 * never loads. That is worse than the gap this scanner closed: a release gate
 * that rejects a valid package blocks shipping, where the regex it replaced
 * merely failed to catch one.
 */
function withoutInertMarkup(html) {
  const blank = (length) => " ".repeat(length);
  // ONE forward scan that understands markup context. Comments were previously
  // stripped by a global regex, which treated a comment delimiter inside a
  // quoted attribute value as a real comment: a page carrying `data-open="<!--"`
  // and `data-close="-->"` had everything between them blanked, including a real
  // script tag, so a package missing that bundle verified clean. Tag interiors
  // are skipped wholesale here, so nothing inside a quoted value is ever read as
  // markup.
  let output = "";
  let index = 0;
  while (index < html.length) {
    const next = html.indexOf("<", index);
    if (next === -1) break;
    output += html.slice(index, next);
    index = next;

    if (html.startsWith("<!--", index)) {
      const close = html.indexOf("-->", index + 4);
      const end = close === -1 ? html.length : close + 3;
      output += blank(end - index);
      index = end;
      continue;
    }

    const rawText = /^<(script|style)\b/i.exec(html.slice(index, index + 8));
    const attributesEnd = tagEnd(html, index + 1);
    if (attributesEnd === -1) break;

    if (rawText) {
      const tagName = rawText[1].toLowerCase();
      const bodyStart = attributesEnd + 1;
      const closeIndex = html.toLowerCase().indexOf(`</${tagName}`, bodyStart);
      const bodyEnd = closeIndex === -1 ? html.length : closeIndex;
      output += html.slice(index, bodyStart) + blank(bodyEnd - bodyStart);
      index = bodyEnd;
      continue;
    }

    // An ordinary tag: copied verbatim and skipped past, so a `<!--` or a `<`
    // inside one of its quoted values is never treated as markup.
    output += html.slice(index, attributesEnd + 1);
    index = attributesEnd + 1;
  }
  return output + html.slice(index);
}

/** Yields each `<tagName ...>` open tag's attributes, lowercased and unquoted. */
function* htmlTags(html, tagName) {
  const openers = new RegExp(`<${tagName}(?=[\\s/>])`, "gi");
  for (const opener of html.matchAll(openers)) {
    const start = opener.index + opener[0].length;
    const end = tagEnd(html, start);
    if (end === -1) continue;
    yield tagAttributes(html.slice(start, end));
  }
}

/** Finds the `>` closing a tag, ignoring one that sits inside a quoted value. */
function tagEnd(html, start) {
  let quote = "";
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function tagAttributes(source) {
  const attributes = new Map();
  const pattern = /([a-z][-a-z0-9:_.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>`=]+))?/gi;
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    // First occurrence wins, which is how a browser resolves a duplicated
    // attribute.
    if (attributes.has(name)) continue;
    const raw = match[2];
    const quoted = raw !== undefined && (raw.startsWith('"') || raw.startsWith("'"));
    attributes.set(name, raw === undefined ? "" : quoted ? raw.slice(1, -1) : raw);
  }
  return attributes;
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
