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
});

async function createReleaseFixture({ provenanceZipSha256 }: { provenanceZipSha256: string }) {
  const cwd = await mkdtemp(path.join(tmpdir(), "pack-release-assets-"));
  createdDirs.push(cwd);
  const binDir = path.join(cwd, "bin");
  const zipPath = path.join(cwd, "complyeazepack-chrome.zip");
  const checksumPath = path.join(cwd, "complyeazepack-chrome.zip.sha256");
  const provenancePath = path.join(cwd, "pack-release-provenance.v1.json");
  const releasePath = path.join(cwd, "release.json");

  await mkdir(binDir, { recursive: true });
  await writeFile(zipPath, "synthetic zip");
  const zipSha256 = createHash("sha256").update("synthetic zip").digest("hex");
  await writeFile(checksumPath, `${zipSha256}  ${path.basename(zipPath)}\n`);
  await writeFile(
    provenancePath,
    `${JSON.stringify(
      {
        package: {
          zipAssetName: path.basename(zipPath),
          zipSha256: provenanceZipSha256,
        },
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
  const ghPath = path.join(binDir, "gh");
  await writeFile(ghPath, '#!/bin/sh\ncat "$PACK_TEST_RELEASE_JSON"\n');
  await chmod(ghPath, 0o755);

  return { binDir, checksumPath, provenancePath, releasePath, zipPath };
}

async function runVerifier({
  binDir,
  checksumPath,
  provenancePath,
  releasePath,
  zipPath,
}: {
  binDir: string;
  checksumPath: string;
  provenancePath: string;
  releasePath: string;
  zipPath: string;
}): Promise<{ output: string; status: number }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [
        "scripts/verify-github-release-assets.mjs",
        "--tag",
        "v0.3.0",
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
