import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const tag = required(args.tag, "--tag");
const checksumFile = required(args.checksum, "--checksum");
const provenanceFile = required(args.provenance, "--provenance");
const zipFile = args.zip ? path.resolve(args.zip) : null;
const repo = process.env.GITHUB_REPOSITORY ?? required(args.repo, "--repo or GITHUB_REPOSITORY");
const checksum = (await readFile(checksumFile, "utf8")).trim().split(/\s+/)[0];
if (!/^[a-f0-9]{64}$/.test(checksum ?? "")) {
  throw new Error(`Invalid SHA-256 checksum in ${checksumFile}`);
}
const provenance = JSON.parse(await readFile(provenanceFile, "utf8"));
// Bind the provenance to the tag the caller asked for. Every other check here is
// internally consistent -- the checksum matches the ZIP, the ZIP name matches the
// provenance, the assets exist on the release -- so a release carrying another
// version's assets and provenance passes all of them while describing a different
// build than the one requested. Since `Chrome Web Store Submit` is now the only
// submission path and takes the tag as an operator-supplied input, that input is
// load-bearing and must be checked rather than trusted.
if (provenance.source?.tag !== tag) {
  throw new Error(
    `Release provenance describes ${
      provenance.source?.tag ?? "an unknown tag"
    }, but ${tag} was requested. Refusing to treat one release's package as another's.`,
  );
}
if (provenance.package?.zipSha256 !== checksum) {
  throw new Error(
    `Release provenance ZIP SHA-256 ${
      provenance.package?.zipSha256 ?? "missing"
    } does not match checksum ${checksum}.`,
  );
}
if (zipFile) {
  const zipSha256 = await sha256File(zipFile);
  if (zipSha256 !== checksum) {
    throw new Error(
      `Downloaded ZIP checksum mismatch for ${zipFile}: expected ${checksum}, received ${zipSha256}.`,
    );
  }
  if (path.basename(zipFile) !== provenance.package.zipAssetName) {
    throw new Error(
      `Downloaded ZIP name mismatch: expected ${provenance.package.zipAssetName}, received ${path.basename(
        zipFile,
      )}.`,
    );
  }
}
// Bind the provenance to the commit the tag actually points at, not just to the tag
// string. A provenance file naming the right tag but built from a different commit
// satisfies every other check here, because they all compare the package with the
// provenance rather than either with the repository.
//
// `git/ref/tags/<tag>` returns the **tag object** for an annotated tag, not the commit,
// so comparing against `.object.sha` directly manufactures a false mismatch on every
// annotated tag. Dereference it when the ref says so.
const tagRef = ghApi(`repos/${repo}/git/ref/tags/${tag}`);
let tagCommit = tagRef.object?.sha;
if (tagRef.object?.type === "tag") {
  tagCommit = ghApi(`repos/${repo}/git/tags/${tagRef.object.sha}`).object?.sha;
}
if (!tagCommit) {
  throw new Error(`Could not resolve ${tag} to a commit; refusing to verify against it.`);
}
if (provenance.source?.commit !== tagCommit) {
  throw new Error(
    `Release provenance was built from ${
      provenance.source?.commit ?? "an unrecorded commit"
    }, but ${tag} points at ${tagCommit}. Refusing to publish a package that does not match the tag.`,
  );
}
const release = JSON.parse(
  execFileSync("gh", ["api", `repos/${repo}/releases/tags/${tag}`], {
    encoding: "utf8",
  }),
);
const assetNames = new Set((release.assets ?? []).map((asset) => asset.name));
const expectedAssets = [
  provenance.package.zipAssetName,
  path.basename(checksumFile),
  path.basename(provenanceFile),
];

for (const assetName of expectedAssets) {
  if (!assetNames.has(assetName)) {
    throw new Error(`GitHub release ${tag} is missing asset ${assetName}.`);
  }
}

const zipAsset = (release.assets ?? []).find(
  (asset) => asset.name === provenance.package.zipAssetName,
);
if (!zipAsset) throw new Error(`GitHub release ${tag} is missing the ZIP asset.`);
if (zipAsset.digest !== `sha256:${checksum}`) {
  throw new Error(
    `GitHub asset digest mismatch for ${zipAsset.name}: expected sha256:${checksum}, received ${
      zipAsset.digest ?? "none"
    }`,
  );
}
if (release.draft) throw new Error(`GitHub release ${tag} must not remain a draft.`);
if (!release.prerelease) throw new Error(`Pack v0 release ${tag} must be marked prerelease.`);

console.log(`Verified GitHub release assets for ${tag}.`);

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

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
}

function ghApi(endpoint) {
  return JSON.parse(execFileSync("gh", ["api", endpoint], { encoding: "utf8" }));
}

async function sha256File(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}
