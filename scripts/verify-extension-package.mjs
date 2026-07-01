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
  /https:\/\/(?:www|services|return)\.gst\.gov\.in\/(?!\*)(?:[^\s"']+)/i;

const manifestPath = path.join(outputDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const expectedName = "ComplyEaze Pack: GST GSTR-3B Downloader";
const expectedShortName = "ComplyEaze Pack";
const expectedDescription = "Download filed GSTR-3B PDFs locally from your GST Portal session.";
const expectedHomepageUrl = "https://pack.complyeaze.com/gst";
const expectedIcons = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png",
};
const expectedPackagedBrandAssets = [
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
];
const expectedPermissions = ["downloads", "scripting", "storage"];
const expectedHostPermissions = [
  "https://www.gst.gov.in/*",
  "https://services.gst.gov.in/*",
  "https://return.gst.gov.in/*",
];

const forbiddenPermissions = new Set([
  "cookies",
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
  await readFile(path.join(outputDir, iconPath));
}

for (const assetPath of expectedPackagedBrandAssets) {
  await readFile(path.join(outputDir, assetPath));
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
];

for (const file of await listFiles(outputDir)) {
  assertNoHarnessPolicyLeaks(path.relative(outputDir, file), file);
  if (!/\.(js|json|html|css|svg)$/.test(file)) continue;
  const contents = await readFile(file, "utf8");
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
  assertNoForbiddenTelemetry(contents, file);
}

console.log("Pack WXT extension package verification passed.");

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
  if (pathfulGstPortalPattern.test(contents)) {
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
}

function validatePolicyPatternSamples(patterns) {
  const samples = new Map([
    ["gstin", ["27ABCDE1234F1Z5"]],
    ["pan", ["ABCDE1234F"]],
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
    ["gst-url", ["https://services.gst.gov.in/services/auth/efiledreturns"]],
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
