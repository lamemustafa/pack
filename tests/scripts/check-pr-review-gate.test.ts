import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();
const scriptPath = path.join(rootDir, "scripts", "check-pr-review-gate.mjs");

describe("PR review gate", () => {
  it("fails when unresolved review threads are present", () => {
    const fixturePath = writeFixture(
      "unresolved-thread",
      reviewFixture({
        headRefOid: "head-sha",
        reviewThreads: [
          {
            id: "thread-1",
            isResolved: false,
            isOutdated: false,
            path: "src/file.ts",
            line: 10,
            comments: {
              nodes: [
                {
                  url: "https://github.com/lamemustafa/pack/pull/1#discussion_r1",
                  author: { login: "chatgpt-codex-connector" },
                  body: "Fix this.",
                },
              ],
            },
          },
        ],
        reviews: [review({ state: "COMMENTED", commit: "head-sha" })],
      }),
    );

    expect(() =>
      execFileSync(process.execPath, [
        scriptPath,
        "--repo",
        "lamemustafa/pack",
        "--pr",
        "14",
        "--fixture",
        fixturePath,
        "--strict-head-review",
        "--required-review-author",
        "chatgpt-codex-connector",
      ]),
    ).toThrow(/Unresolved review threads/);
  });

  it("fails when the current head has a requested-changes review", () => {
    const fixturePath = writeFixture(
      "current-head-requested-changes",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [review({ state: "CHANGES_REQUESTED", commit: "head-sha" })],
      }),
    );

    expect(() =>
      execFileSync(process.execPath, [
        scriptPath,
        "--repo",
        "lamemustafa/pack",
        "--pr",
        "14",
        "--fixture",
        fixturePath,
        "--strict-head-review",
        "--required-review-author",
        "chatgpt-codex-connector",
      ]),
    ).toThrow(/Requested-changes reviews/);
  });

  it("ignores stale requested-changes reviews once the current head has a later review", () => {
    const fixturePath = writeFixture(
      "stale-requested-changes",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({ state: "CHANGES_REQUESTED", commit: "old-sha" }),
          review({ state: "COMMENTED", commit: "head-sha" }),
        ],
      }),
    );

    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
        "--repo",
        "lamemustafa/pack",
        "--pr",
        "14",
        "--fixture",
        fixturePath,
        "--strict-head-review",
        "--required-review-author",
        "chatgpt-codex-connector",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
      },
    );

    expect(output).toContain("PR review gate passed");
  });

  it("fails strict mode when the required current-head review is missing", () => {
    const fixturePath = writeFixture(
      "missing-head-review",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [review({ state: "COMMENTED", commit: "old-sha" })],
      }),
    );

    expect(() =>
      execFileSync(process.execPath, [
        scriptPath,
        "--repo",
        "lamemustafa/pack",
        "--pr",
        "14",
        "--fixture",
        fixturePath,
        "--strict-head-review",
        "--required-review-author",
        "chatgpt-codex-connector",
      ]),
    ).toThrow(/No review was found for current head/);
  });

  it("fails when the PR body omits the required Pack workflow checklist", () => {
    const fixturePath = writeFixture(
      "missing-template-body",
      reviewFixture({
        body: "## Summary\n\nNo Pack workflow checklist.",
        headRefName: "tapish-codex/missing-body",
        headRefOid: "head-sha",
        reviews: [review({ state: "COMMENTED", commit: "head-sha" })],
      }),
    );

    expect(() =>
      execFileSync(process.execPath, [
        scriptPath,
        "--repo",
        "lamemustafa/pack",
        "--pr",
        "14",
        "--fixture",
        fixturePath,
        "--strict-head-review",
        "--required-review-author",
        "chatgpt-codex-connector",
      ]),
    ).toThrow(/PR body workflow\/template issues/);
  });

  it("allows fork PRs from default branch names while warning on naming", () => {
    const fixturePath = writeFixture(
      "fork-main-branch",
      reviewFixture({
        headRefName: "main",
        headRepository: { nameWithOwner: "external/pack-fork" },
        headRefOid: "head-sha",
        reviews: [review({ state: "COMMENTED", commit: "head-sha" })],
      }),
    );

    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
        "--repo",
        "lamemustafa/pack",
        "--pr",
        "14",
        "--fixture",
        fixturePath,
        "--strict-head-review",
        "--required-review-author",
        "chatgpt-codex-connector",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
      },
    );

    expect(output).toContain("PR review gate passed");
  });

  it("can allow a missing head review for finding-only CI gates", () => {
    const fixturePath = writeFixture(
      "allowed-missing-head-review",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [review({ state: "COMMENTED", commit: "old-sha" })],
      }),
    );

    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
        "--repo",
        "lamemustafa/pack",
        "--pr",
        "14",
        "--fixture",
        fixturePath,
        "--strict-head-review",
        "--required-review-author",
        "chatgpt-codex-connector",
        "--allow-missing-head-review",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
      },
    );

    expect(output).toContain("PR review gate passed");
  });

  it("waits for a current-head review instead of treating the first snapshot as final", () => {
    const firstFixture = writeFixture(
      "no-head-review",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [review({ state: "COMMENTED", commit: "old-sha" })],
      }),
    );
    const secondFixture = writeFixture(
      "head-review",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({ state: "COMMENTED", commit: "old-sha" }),
          review({ state: "COMMENTED", commit: "head-sha" }),
        ],
      }),
    );

    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
        "--repo",
        "lamemustafa/pack",
        "--pr",
        "14",
        "--fixture-sequence",
        `${firstFixture},${secondFixture}`,
        "--strict-head-review",
        "--wait-head-review-ms",
        "5",
        "--poll-interval-ms",
        "1",
        "--required-review-author",
        "chatgpt-codex-connector",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
      },
    );

    expect(output).toContain("PR review gate passed");
  });
});

function writeFixture(name: string, value: unknown): string {
  const directory = mkdtempSync(path.join(tmpdir(), "pack-review-gate-"));
  const fixturePath = path.join(directory, `${name}.json`);
  writeFileSync(fixturePath, JSON.stringify(value), "utf8");
  return fixturePath;
}

function reviewFixture({
  headRefOid,
  headRefName = "tapish-codex/test-pr",
  baseRefName = "master",
  headRepository = { nameWithOwner: "lamemustafa/pack" },
  body = packPrBody(),
  reviewThreads = [],
  reviews,
}: {
  headRefOid: string;
  headRefName?: string;
  baseRefName?: string;
  headRepository?: { nameWithOwner: string };
  body?: string;
  reviewThreads?: unknown[];
  reviews: Array<ReturnType<typeof review>>;
}) {
  return {
    data: {
      repository: {
        pullRequest: {
          body,
          headRefName,
          baseRefName,
          headRepository,
          headRefOid,
          reviewThreads: { nodes: reviewThreads },
          reviews: { nodes: reviews },
        },
      },
    },
  };
}

function packPrBody() {
  return [
    "## Summary",
    "## Pack Workflow Preflight",
    "- [x] `pnpm workflow:preflight` was run before editing/push, or the skip reason is documented.",
    "## Privacy And Data-Flow Impact",
    "## Sensitive Surface Review",
    "## Verification",
    "## PR Review Follow-Up",
  ].join("\n\n");
}

function review({ state, commit }: { state: "COMMENTED" | "CHANGES_REQUESTED"; commit: string }) {
  return {
    state,
    submittedAt: "2026-06-24T17:45:40Z",
    url: `https://github.com/lamemustafa/pack/pull/14#${commit}-${state}`,
    author: { login: "chatgpt-codex-connector" },
    commit: { oid: commit },
  };
}
