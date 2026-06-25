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

  it("does not count dismissed current-head reviews as satisfying strict review", () => {
    const fixturePath = writeFixture(
      "dismissed-head-review",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [review({ state: "DISMISSED", commit: "head-sha" })],
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

  it("uses each reviewer's latest non-dismissed current-head review state", () => {
    const fixturePath = writeFixture(
      "requested-changes-then-approval",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({
            state: "CHANGES_REQUESTED",
            commit: "head-sha",
            submittedAt: "2026-06-24T17:45:40Z",
          }),
          review({ state: "APPROVED", commit: "head-sha", submittedAt: "2026-06-24T17:55:40Z" }),
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

  it("keeps requested changes blocking when a later comment is submitted", () => {
    const fixturePath = writeFixture(
      "requested-changes-then-comment",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({
            state: "CHANGES_REQUESTED",
            commit: "head-sha",
            submittedAt: "2026-06-24T17:45:40Z",
          }),
          review({ state: "COMMENTED", commit: "head-sha", submittedAt: "2026-06-24T17:55:40Z" }),
        ],
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

  it("treats a later approval as clearing requested changes", () => {
    const fixturePath = writeFixture(
      "requested-changes-then-approval-clears",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({
            state: "CHANGES_REQUESTED",
            commit: "head-sha",
            submittedAt: "2026-06-24T17:45:40Z",
          }),
          review({ state: "APPROVED", commit: "head-sha", submittedAt: "2026-06-24T17:55:40Z" }),
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

  it("keeps an earlier approval when a later review is dismissed", () => {
    const fixturePath = writeFixture(
      "approval-then-dismissed",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({
            state: "APPROVED",
            commit: "head-sha",
            submittedAt: "2026-06-24T17:45:40Z",
          }),
          review({ state: "DISMISSED", commit: "head-sha", submittedAt: "2026-06-24T17:55:40Z" }),
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

  it("keeps an earlier comment when later requested changes are dismissed", () => {
    const fixturePath = writeFixture(
      "comment-requested-changes-dismissed",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({ state: "COMMENTED", commit: "head-sha", submittedAt: "2026-06-24T17:40:40Z" }),
          review({
            state: "CHANGES_REQUESTED",
            commit: "head-sha",
            submittedAt: "2026-06-24T17:45:40Z",
          }),
          review({ state: "DISMISSED", commit: "head-sha", submittedAt: "2026-06-24T17:55:40Z" }),
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

  it("treats a dismissed requested-changes review as no submitted head review when there is no earlier review", () => {
    const fixturePath = writeFixture(
      "requested-changes-then-dismissed",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({
            state: "CHANGES_REQUESTED",
            commit: "head-sha",
            submittedAt: "2026-06-24T17:45:40Z",
          }),
          review({ state: "DISMISSED", commit: "head-sha", submittedAt: "2026-06-24T17:55:40Z" }),
        ],
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

  it("does not count pending reviews as submitted head reviews", () => {
    const fixturePath = writeFixture(
      "pending-head-review",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [review({ state: "PENDING", commit: "head-sha" })],
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

  it("keeps commitless requested-change reviews blocking", () => {
    const fixturePath = writeFixture(
      "commitless-requested-changes",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({ state: "COMMENTED", commit: "head-sha" }),
          review({ state: "CHANGES_REQUESTED", commit: null }),
        ],
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

  it("evaluates review state from paginated fixture pages", () => {
    const fixturePath = writeFixture("paginated-review-state", {
      pages: [
        reviewFixture({
          headRefOid: "head-sha",
          reviewThreads: [],
          reviews: [review({ state: "COMMENTED", commit: "old-sha" })],
          reviewsPageInfo: { hasNextPage: true, endCursor: "reviews-page-1" },
        }),
        reviewFixture({
          headRefOid: "head-sha",
          reviewThreads: [],
          reviews: [review({ state: "CHANGES_REQUESTED", commit: "head-sha" })],
          reviewsPageInfo: { hasNextPage: false, endCursor: null },
        }),
      ],
    });

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
  reviewThreads = [],
  reviewThreadsPageInfo = { hasNextPage: false, endCursor: null },
  reviews,
  reviewsPageInfo = { hasNextPage: false, endCursor: null },
}: {
  headRefOid: string;
  reviewThreads?: unknown[];
  reviewThreadsPageInfo?: { hasNextPage: boolean; endCursor: string | null };
  reviews: Array<ReturnType<typeof review>>;
  reviewsPageInfo?: { hasNextPage: boolean; endCursor: string | null };
}) {
  return {
    data: {
      repository: {
        pullRequest: {
          headRefOid,
          reviewThreads: { nodes: reviewThreads, pageInfo: reviewThreadsPageInfo },
          reviews: { nodes: reviews, pageInfo: reviewsPageInfo },
        },
      },
    },
  };
}

function review({
  state,
  commit,
  submittedAt = "2026-06-24T17:45:40Z",
}: {
  state: "APPROVED" | "COMMENTED" | "CHANGES_REQUESTED" | "DISMISSED" | "PENDING";
  commit: string | null;
  submittedAt?: string;
}) {
  return {
    state,
    submittedAt,
    url: `https://github.com/lamemustafa/pack/pull/14#${commit}-${state}`,
    author: { login: "chatgpt-codex-connector" },
    commit: commit ? { oid: commit } : null,
  };
}
