import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Declared here, not beside `resolveTagCommit`: this file runs top-level code before the
// declarations at the bottom, and a `const` in temporal dead zone throws at run time while
// `node --check` still reports the file as valid.
const MAX_TAG_DEREFERENCES = 8;

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
const tagCommit = resolveTagCommit(tag);
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

// Git refs may point at a commit, a tag object, a tree, or a blob, and a tag object may
// point at any of those -- including another tag. So resolution is: dereference while the
// type is `tag`, then require the terminal object to be a commit. Taking the first SHA and
// assuming it is a commit accepts a tree or blob as a "source commit", which is the
// could-not-determine-treated-as-matches shape guards here are required not to have.
//
// This is the whole of git's object model for this question, not an approximation of it:
// once the loop terminates the type is commit or the resolution failed, with nothing left
// unhandled.
function resolveTagCommit(tagName) {
  let object = ghApi(`repos/${repo}/git/ref/tags/${tagName}`).object;

  for (let depth = 0; object?.type === "tag"; depth += 1) {
    // Content addressing makes a cycle impossible in a healthy repository, so a bound
    // exceeded means the responses are not trustworthy. Fail rather than loop.
    if (depth >= MAX_TAG_DEREFERENCES) {
      throw new Error(
        `Tag ${tagName} did not resolve to a commit within ${MAX_TAG_DEREFERENCES} dereferences; refusing to verify against it.`,
      );
    }
    object = ghApi(`repos/${repo}/git/tags/${object.sha}`).object;
  }

  if (object?.type !== "commit" || !object.sha) {
    throw new Error(
      `Tag ${tagName} resolves to ${
        object?.type ? `a ${object.type} object` : "no object"
      } (${object?.sha ?? "unknown"}), not a commit. Refusing to verify a release against it.`,
    );
  }

  return object.sha;
}

function ghApi(endpoint) {
  return JSON.parse(execFileSync("gh", ["api", endpoint], { encoding: "utf8" }));
}

async function sha256File(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}
