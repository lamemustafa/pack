import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const rootDir = process.cwd();
const createdDirs: string[] = [];

describe("GitHub release asset verifier", () => {
  afterEach(async () => {
    await Promise.all(
      createdDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
    );
  });

  it("rejects release provenance when package.zipSha256 does not match the checksum", async () => {
    const fixture = await createReleaseFixture({
      provenanceZipSha256: "0".repeat(64),
    });

    const result = await runVerifier(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Release provenance ZIP SHA-256");
  });

  // `Chrome Web Store Submit` is the only submission path and takes the tag as an
  // operator-supplied input, so the tag is load-bearing. Every other check in the
  // verifier is internally consistent: a release carrying another version's ZIP,
  // checksum, and provenance satisfies all of them while describing a different build
  // than the one requested.
  it("rejects provenance that describes a different tag than the one requested", async () => {
    const fixture = await createReleaseFixture({
      provenanceSourceTag: "v0.9.9",
      provenanceZipSha256: SYNTHETIC_ZIP_SHA256,
    });

    const result = await runVerifier(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("describes v0.9.9");
    expect(result.output).toContain(`${REQUESTED_TAG} was requested`);
  });

  it("rejects provenance with no recorded source tag", async () => {
    const fixture = await createReleaseFixture({
      provenanceSourceTag: null,
      provenanceZipSha256: SYNTHETIC_ZIP_SHA256,
    });

    const result = await runVerifier(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("an unknown tag");
  });

  // Codex reproduced this with source.commit=deadbeef verifying successfully: the tag
  // string can be right while the build came from a different commit, and every other
  // check compares the package with the provenance rather than either with the repo.
  it("rejects provenance built from a commit the tag does not point at", async () => {
    const fixture = await createReleaseFixture({
      provenanceSourceCommit: "d".repeat(40),
      provenanceZipSha256: SYNTHETIC_ZIP_SHA256,
    });

    const result = await runVerifier(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("was built from");
    expect(result.output).toContain(TAG_COMMIT);
  });

  it("rejects provenance with no recorded source commit", async () => {
    const fixture = await createReleaseFixture({
      provenanceSourceCommit: null,
      provenanceZipSha256: SYNTHETIC_ZIP_SHA256,
    });

    const result = await runVerifier(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("an unrecorded commit");
  });

  // `git/ref/tags/<tag>` returns the tag *object* for an annotated tag, not the commit.
  // Comparing against it directly manufactures a false mismatch on every annotated tag,
  // so the verifier must dereference. Without that, this case fails.
  it("dereferences an annotated tag to its commit rather than comparing the tag object", async () => {
    const fixture = await createReleaseFixture({
      tagChain: ANNOTATED_TO_COMMIT,
      provenanceZipSha256: SYNTHETIC_ZIP_SHA256,
    });

    const result = await runVerifier(fixture);

    expect({ status: result.status, output: result.output }).toEqual({
      status: 0,
      output: expect.stringContaining("Verified GitHub release assets"),
    });
  });

  // Git permits a tag to point at a tree or a blob. Taking that SHA as "the source
  // commit" establishes nothing, and provenance naming the same SHA would then verify --
  // the could-not-determine-treated-as-matches shape guards here must not have.
  it.each([
    { label: "blob", type: "blob" },
    { label: "tree", type: "tree" },
  ])("rejects a tag that resolves to a $label rather than a commit", async ({ type }) => {
    const fixture = await createReleaseFixture({
      provenanceSourceCommit: TREE_OBJECT,
      provenanceZipSha256: SYNTHETIC_ZIP_SHA256,
      tagChain: [{ sha: TREE_OBJECT, type }],
    });

    const result = await runVerifier(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(`a ${type} object`);
    expect(result.output).toContain("not a commit");
  });

  // A tag object may point at another tag object, so one dereference is not enough.
  it("dereferences a chain of annotated tags to the commit at its end", async () => {
    const fixture = await createReleaseFixture({
      provenanceZipSha256: SYNTHETIC_ZIP_SHA256,
      tagChain: [
        { sha: ANNOTATED_TAG_OBJECT, type: "tag" },
        { sha: NESTED_TAG_OBJECT, type: "tag" },
        { sha: TAG_COMMIT, type: "commit" },
      ],
    });

    const result = await runVerifier(fixture);

    expect({ status: result.status, output: result.output }).toEqual({
      status: 0,
      output: expect.stringContaining("Verified GitHub release assets"),
    });
  });

  // A chain that never terminates in a commit must fail rather than loop forever.
  it("refuses to dereference a tag chain without end", async () => {
    const fixture = await createReleaseFixture({
      provenanceZipSha256: SYNTHETIC_ZIP_SHA256,
      tagChain: Array.from({ length: 12 }, (_unused, index) => ({
        sha: `${index}`.padStart(40, "f"),
        type: "tag",
      })),
    });

    const result = await runVerifier(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("did not resolve to a commit within");
  });
});

const REQUESTED_TAG = "v0.3.0";
const SYNTHETIC_ZIP_CONTENT = "synthetic zip";
// A matching checksum, so a failure in the tests below is unambiguously the tag binding
// and not the checksum guard that runs alongside it.
const SYNTHETIC_ZIP_SHA256 = createHash("sha256").update(SYNTHETIC_ZIP_CONTENT).digest("hex");
const TAG_COMMIT = "a".repeat(40);
const ANNOTATED_TAG_OBJECT = "b".repeat(40);
const NESTED_TAG_OBJECT = "c".repeat(40);
const TREE_OBJECT = "e".repeat(40);

// A git ref points at a commit, a tag object, a tree, or a blob, and a tag object points
// at any of those in turn. Fixtures describe that chain directly: entry 0 is what the ref
// names, and each subsequent entry is what the previous tag object dereferences to.
type GitObject = { sha: string; type: string };
const LIGHTWEIGHT_TO_COMMIT: GitObject[] = [{ sha: TAG_COMMIT, type: "commit" }];
const ANNOTATED_TO_COMMIT: GitObject[] = [
  { sha: ANNOTATED_TAG_OBJECT, type: "tag" },
  { sha: TAG_COMMIT, type: "commit" },
];

async function createReleaseFixture({
  provenanceZipSha256,
  provenanceSourceTag = REQUESTED_TAG,
  provenanceSourceCommit = TAG_COMMIT,
  tagChain = LIGHTWEIGHT_TO_COMMIT,
}: {
  provenanceZipSha256: string;
  provenanceSourceTag?: string | null;
  provenanceSourceCommit?: string | null;
  tagChain?: GitObject[];
}) {
  const cwd = await mkdtemp(path.join(tmpdir(), "pack-release-assets-"));
  createdDirs.push(cwd);
  const binDir = path.join(cwd, "bin");
  const zipPath = path.join(cwd, "complyeazepack-chrome.zip");
  const checksumPath = path.join(cwd, "complyeazepack-chrome.zip.sha256");
  const provenancePath = path.join(cwd, "pack-release-provenance.v1.json");
  const releasePath = path.join(cwd, "release.json");

  await mkdir(binDir, { recursive: true });
  await writeFile(zipPath, SYNTHETIC_ZIP_CONTENT);
  const zipSha256 = SYNTHETIC_ZIP_SHA256;
  await writeFile(checksumPath, `${zipSha256}  ${path.basename(zipPath)}\n`);
  await writeFile(
    provenancePath,
    `${JSON.stringify(
      {
        package: {
          zipAssetName: path.basename(zipPath),
          zipSha256: provenanceZipSha256,
        },
        ...(provenanceSourceTag === null && provenanceSourceCommit === null
          ? {}
          : {
              source: {
                ...(provenanceSourceTag === null ? {} : { tag: provenanceSourceTag }),
                ...(provenanceSourceCommit === null ? {} : { commit: provenanceSourceCommit }),
              },
            }),
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    releasePath,
    `${JSON.stringify({
      assets: [
        { name: path.basename(zipPath), digest: `sha256:${zipSha256}` },
        { name: path.basename(checksumPath) },
        { name: path.basename(provenancePath) },
      ],
      draft: false,
      prerelease: true,
    })}\n`,
  );
  // The ref names the first object; every tag object in the chain gets a file named by
  // its own SHA, so the fake `gh` resolves a real chain instead of replaying one hop.
  const objectsDir = path.join(cwd, "objects");
  await mkdir(objectsDir, { recursive: true });
  const tagRefPath = path.join(cwd, "tag-ref.json");
  await writeFile(tagRefPath, `${JSON.stringify({ object: tagChain[0] })}\n`);
  for (let i = 0; i < tagChain.length - 1; i += 1) {
    await writeFile(
      path.join(objectsDir, `${tagChain[i]?.sha}.json`),
      `${JSON.stringify({ object: tagChain[i + 1] })}\n`,
    );
  }

  const ghPath = path.join(binDir, "gh");
  await writeFile(
    ghPath,
    [
      "#!/bin/sh",
      'case "$2" in',
      '  */git/ref/tags/*) cat "$PACK_TEST_TAG_REF_JSON" ;;',
      '  */git/tags/*)     cat "$PACK_TEST_OBJECTS_DIR/$(basename "$2").json" ;;',
      '  *)                cat "$PACK_TEST_RELEASE_JSON" ;;',
      "esac",
      "",
    ].join("\n"),
  );
  await chmod(ghPath, 0o755);

  return { binDir, checksumPath, objectsDir, provenancePath, releasePath, tagRefPath, zipPath };
}

async function runVerifier({
  binDir,
  checksumPath,
  provenancePath,
  objectsDir,
  releasePath,
  tagRefPath,
  zipPath,
}: {
  binDir: string;
  checksumPath: string;
  objectsDir: string;
  provenancePath: string;
  releasePath: string;
  tagRefPath: string;
  zipPath: string;
}): Promise<{ output: string; status: number }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [
        "scripts/verify-github-release-assets.mjs",
        "--tag",
        REQUESTED_TAG,
        "--checksum",
        checksumPath,
        "--provenance",
        provenancePath,
        "--zip",
        zipPath,
        "--repo",
        "lamemustafa/pack",
      ],
      {
        cwd: rootDir,
        env: {
          ...process.env,
          PACK_TEST_RELEASE_JSON: releasePath,
          PACK_TEST_OBJECTS_DIR: objectsDir,
          PACK_TEST_TAG_REF_JSON: tagRefPath,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
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
