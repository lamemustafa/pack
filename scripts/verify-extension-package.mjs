import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const outputDir = process.argv[2];
if (!outputDir)
  throw new Error("usage: node scripts/verify-extension-package.mjs <extension-output-dir>");

const manifestPath = path.join(outputDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const expectedName = "ComplyEaze Pack: GST GSTR-3B Downloader";
const expectedShortName = "ComplyEaze Pack";
const expectedDescription = "Download filed GSTR-3B PDFs locally from your GST Portal session.";
const expectedHomepageUrl = "https://github.com/lamemustafa/complyeaze-pack";
const expectedIcons = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png",
};
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

for (const [size, iconPath] of Object.entries(expectedIcons)) {
  if (manifest.icons?.[size] !== iconPath) {
    throw new Error(`Missing required ${size}px icon: ${iconPath}`);
  }
  await readFile(path.join(outputDir, iconPath));
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
  if (!/\.(js|json|html|css)$/.test(file)) continue;
  const contents = await readFile(file, "utf8");
  for (const pattern of forbiddenBuiltArtifactPatterns) {
    if (pattern.test(contents))
      throw new Error(`Forbidden pattern ${pattern} in ${path.relative(process.cwd(), file)}`);
  }
}

for (const file of await listFiles(path.join(process.cwd(), "src"))) {
  if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
  const contents = await readFile(file, "utf8");
  for (const pattern of forbiddenPackSourcePatterns) {
    if (pattern.test(contents))
      throw new Error(
        `Sensitive Pack source marker ${pattern} in ${path.relative(process.cwd(), file)}`,
      );
  }
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
