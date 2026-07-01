import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const outputDir = path.join(process.cwd(), ".output");
const zipPath = args.zip ? path.resolve(args.zip) : await findSingleChromeZip(outputDir);
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(
  await readFile(path.join(outputDir, "chrome-mv3", "manifest.json"), "utf8"),
);
const sourceCommit = git(["rev-parse", "HEAD"]);
const sourceTag = `v${packageJson.version}`;
const zipSha256 = await sha256File(zipPath);
const checksumPath = args.checksum
  ? path.resolve(args.checksum)
  : path.join(outputDir, `complyeazepack-${packageJson.version}-chrome.zip.sha256`);
const provenancePath = args.output
  ? path.resolve(args.output)
  : path.join(outputDir, "pack-release-provenance.v1.json");

await writeFile(checksumPath, `${zipSha256}  ${path.relative(process.cwd(), zipPath)}\n`);

const provenance = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  product: {
    name: "ComplyEaze Pack",
    packageName: packageJson.name,
    version: packageJson.version,
    sourceRepository: normalizeRepositoryUrl(packageJson.repository?.url),
  },
  source: {
    tag: sourceTag,
    commit: sourceCommit,
  },
  chromeWebStore: {
    extensionId: process.env.CWS_EXTENSION_ID ?? "nfnbhekccajjfgkppolomflaeledoccb",
    listingUrl:
      "https://chromewebstore.google.com/detail/complyeaze-pack-gst-gstr/nfnbhekccajjfgkppolomflaeledoccb",
    publishMode: "protected-environment-after-github-release",
  },
  package: {
    zipAssetName: path.basename(zipPath),
    zipSha256,
    checksumAssetName: path.basename(checksumPath),
  },
  manifest: {
    manifestVersion: manifest.manifest_version,
    name: manifest.name,
    shortName: manifest.short_name,
    description: manifest.description,
    version: manifest.version,
    homepageUrl: manifest.homepage_url,
    permissions: manifest.permissions ?? [],
    hostPermissions: manifest.host_permissions ?? [],
    contentSecurityPolicy: manifest.content_security_policy?.extension_pages ?? null,
  },
  verification: {
    requiredCommands: [
      "pnpm install --frozen-lockfile",
      "pnpm audit --audit-level high",
      "pnpm exec wxt prepare",
      "pnpm exec prettier --check .",
      "pnpm exec eslint . --max-warnings 0",
      "pnpm exec tsc --noEmit",
      "pnpm exec vitest run",
      "pnpm exec wxt build",
      "node scripts/verify-extension-package.mjs .output/chrome-mv3",
      "pnpm verify:clean",
      "pnpm exec wxt zip",
      "xvfb-run --auto-servernum node scripts/verify-extension-zip.mjs",
    ],
    artifactPolicy:
      "Generated ZIPs and checksums are GitHub release assets; they are not committed to source.",
  },
};

await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), checksumPath)}`);
console.log(`Wrote ${path.relative(process.cwd(), provenancePath)}`);
console.log(`Pack release ZIP SHA-256: ${zipSha256}`);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key?.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    parsed[key.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

async function findSingleChromeZip(dir) {
  const entries = await readdir(dir);
  const zipFiles = entries
    .filter((entry) => entry.endsWith(".zip") && entry.includes("chrome"))
    .map((entry) => path.join(dir, entry));
  if (zipFiles.length !== 1) {
    throw new Error(`Expected exactly one Chrome ZIP in ${dir}, found ${zipFiles.length}.`);
  }
  return zipFiles[0];
}

async function sha256File(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function normalizeRepositoryUrl(url) {
  return typeof url === "string" ? url.replace(/\.git$/, "") : null;
}
