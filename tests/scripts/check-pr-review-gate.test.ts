import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();
const scriptPath = path.join(rootDir, "scripts", "check-pr-review-gate.mjs");

describe("PR review gate", () => {
  it("fetches the minimization reason on initial and paginated PR comments", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script.match(/isMinimized minimizedReason/g)).toHaveLength(2);
  });

  it.each([
    ["unresolved finding", [prFindingComment()], 1],
    ["resolved finding", [prFindingComment({ isMinimized: true, minimizedReason: "resolved" })], 0],
    [
      "off-topic minimization",
      [prFindingComment({ isMinimized: true, minimizedReason: "off-topic" })],
      1,
    ],
    [
      "outdated minimization",
      [prFindingComment({ isMinimized: true, minimizedReason: "outdated" })],
      1,
    ],
    ["unrelated author", [prFindingComment({ author: "external-reviewer" })], 0],
    [
      "non-finding notes",
      [
        prFindingComment({ body: "Codex Review: Didn't find any major issues. Breezy!" }),
        prFindingComment({ body: "To use Codex here, create an environment for this repo." }),
      ],
      0,
    ],
  ])("maps PR-level %s", (name, comments, expectedExit) => {
    const result = runGateFixture(name, comments);
    expect(result.status).toBe(expectedExit);
    expect(expectedExit === 0 ? result.stdout : result.stderr).toContain(
      expectedExit === 0 ? "PR review gate passed" : "Unresolved PR-level review findings",
    );
    if (name === "unresolved finding") {
      expect(result.stderr).toContain("Hide → Resolved");
      expect(result.stderr).toContain("next scheduled Review gate run");
    }
  });

  it("keeps a durably observed finding blocking after its source comment is deleted", () => {
    const fixture = writeFixture(
      "durably-observed-deleted-finding",
      reviewFixture({
        headRefOid: "head-sha",
        comments: [],
        reviews: [review({ state: "COMMENTED", commit: "head-sha" })],
      }),
    );
    const state = writeFixture("durable-review-state", {
      version: 1,
      prNumber: 14,
      findings: [
        {
          commentId: "comment-deleted-after-observation",
          author: "chatgpt-codex-connector",
          createdAt: "2026-08-17T12:00:00Z",
          disposition: "open",
        },
      ],
    });

    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--repo",
        "lamemustafa/pack",
        "--pr",
        "14",
        "--fixture",
        fixture,
        "--review-state",
        state,
      ],
      { cwd: rootDir, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Durably observed PR-level review findings");
  });

  it("keeps Hide → Resolved durable after the source comment is deleted", () => {
    const resolvedFixture = writeFixture(
      "resolved-durable-finding",
      reviewFixture({
        headRefOid: "head-sha",
        comments: [prFindingComment({ isMinimized: true, minimizedReason: "resolved" })],
        reviews: [review({ state: "COMMENTED", commit: "head-sha" })],
      }),
    );
    const statePath = writeFixture("open-durable-finding", {
      version: 1,
      prNumber: 14,
      findings: [
        {
          commentId: "comment-1",
          author: "chatgpt-codex-connector",
          createdAt: "2026-08-17T12:00:00Z",
          disposition: "open",
        },
      ],
    });
    const nextStatePath = statePath.replace(".json", ".next.json");

    const resolved = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--repo",
        "lamemustafa/pack",
        "--pr",
        "14",
        "--fixture",
        resolvedFixture,
        "--review-state",
        statePath,
        "--write-review-state",
        nextStatePath,
      ],
      { cwd: rootDir, encoding: "utf8" },
    );

    expect(resolved.status).toBe(0);
    expect(JSON.parse(readFileSync(nextStatePath, "utf8"))).toMatchObject({
      findings: [expect.objectContaining({ commentId: "comment-1", disposition: "resolved" })],
    });

    const deleted = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--repo",
        "lamemustafa/pack",
        "--pr",
        "14",
        "--fixture",
        writeFixture(
          "deleted-resolved-finding",
          reviewFixture({
            headRefOid: "head-sha",
            comments: [],
            reviews: [review({ state: "COMMENTED", commit: "head-sha" })],
          }),
        ),
        "--review-state",
        nextStatePath,
      ],
      { cwd: rootDir, encoding: "utf8" },
    );

    expect(deleted.status).toBe(0);
  });

  it("persists a trusted fixed disposition after the source finding is deleted", () => {
    const statePath = writeFixture("open-finding-for-fixed-disposition", {
      version: 1,
      prNumber: 14,
      findings: [
        {
          commentId: "comment-deleted-after-observation",
          author: "chatgpt-codex-connector",
          createdAt: "2026-08-17T12:00:00Z",
          disposition: "open",
        },
      ],
    });
    const nextStatePath = statePath.replace(".json", ".fixed.json");
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--repo",
        "lamemustafa/pack",
        "--pr",
        "14",
        "--fixture",
        writeFixture(
          "deleted-finding-fixed-disposition",
          reviewFixture({
            headRefOid: "head-sha",
            comments: [durableDispositionComment("comment-deleted-after-observation", "fixed")],
            reviews: [review({ state: "COMMENTED", commit: "head-sha" })],
          }),
        ),
        "--review-state",
        statePath,
        "--write-review-state",
        nextStatePath,
      ],
      { cwd: rootDir, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(nextStatePath, "utf8"))).toMatchObject({
      findings: [
        expect.objectContaining({
          commentId: "comment-deleted-after-observation",
          disposition: "fixed",
        }),
      ],
    });
  });

  it("fails closed when a durable disposition has no visible evidence", () => {
    const result = runGateFixture("marker-only durable disposition", [
      prFindingComment(),
      {
        ...durableDispositionComment("comment-1", "fixed"),
        body: '<!-- review-gate-disposition:{"findingId":"comment-1","disposition":"fixed"} -->',
      },
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("must include visible evidence");
  });

  it("rejects unlinked prose as evidence for a terminal disposition", () => {
    const disposition = durableDispositionComment("comment-1", "fixed");
    disposition.body = `<!-- review-gate-disposition:${JSON.stringify({
      findingId: "comment-1",
      disposition: "fixed",
    })} -->

Evidence: noted.`;
    const result = runGateFixture("unlinked terminal disposition", [
      prFindingComment(),
      disposition,
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("finding-linked, disposition-specific visible evidence");
  });

  it("requires reasoning when rejecting a durable finding", () => {
    const disposition = durableDispositionComment("comment-1", "rejected");
    disposition.body = disposition.body.replace(/\nReasoning:.*$/u, "");
    const result = runGateFixture("unreasoned rejection", [prFindingComment(), disposition]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("finding-linked, disposition-specific visible evidence");
  });

  it("requires a linked follow-up to appear in the PR body", () => {
    const result = runGateFixture("unrecorded linked follow-up", [
      prFindingComment(),
      durableDispositionComment("comment-1", "linked-follow-up", "#999"),
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("must name its follow-up in the PR body");
  });

  it("does not treat a longer issue reference as the named linked follow-up", () => {
    const result = runGateFixture(
      "partial linked follow-up reference",
      [prFindingComment(), durableDispositionComment("comment-1", "linked-follow-up", "#12")],
      packPrBody() + String.fromCharCode(10) + "#123",
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("must name its follow-up in the PR body");
  });

  it.each([
    ["missing", "/tmp/pack-review-gate-state-does-not-exist.json"],
    [
      "malformed",
      writeFixture("malformed-durable-state", {
        version: 1,
        prNumber: 14,
        findings: [{ commentId: "comment-1", disposition: "open" }],
      }),
    ],
  ])("fails closed for %s durable review state", (_name, statePath) => {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--repo",
        "lamemustafa/pack",
        "--pr",
        "14",
        "--fixture",
        writeFixture(
          "review-state-validation",
          reviewFixture({
            headRefOid: "head-sha",
            reviews: [review({ state: "COMMENTED", commit: "head-sha" })],
          }),
        ),
        "--review-state",
        statePath,
      ],
      { cwd: rootDir, encoding: "utf8" },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Review gate could not evaluate");
  });

  it("evaluates PR-level findings from paginated fixture pages", () => {
    const fixturePath = writeFixture("paginated-pr-level-findings", {
      pages: [
        reviewFixture({
          headRefOid: "head-sha",
          comments: [],
          commentsPageInfo: { hasNextPage: true, endCursor: "comments-page-1" },
          reviews: [review({ state: "COMMENTED", commit: "head-sha" })],
        }),
        reviewFixture({
          headRefOid: "head-sha",
          comments: [prFindingComment()],
          reviews: [],
        }),
      ],
    });

    const result = spawnSync(
      process.execPath,
      [scriptPath, "--repo", "lamemustafa/pack", "--pr", "14", "--fixture", fixturePath],
      { cwd: rootDir, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unresolved PR-level review findings");
  });

  it("fails as could-not-evaluate when a live pagination page has no PR data", () => {
    const firstPage = reviewFixture({
      headRefOid: "head-sha",
      commentsPageInfo: { hasNextPage: true, endCursor: "comments-page-1" },
      reviews: [review({ state: "COMMENTED", commit: "head-sha" })],
    });
    const missingPrPage = { data: { repository: { pullRequest: null } } };
    const { result, attempts } = runGateWithFakeGh([
      { status: 0, stdout: JSON.stringify(firstPage) },
      { status: 0, stdout: JSON.stringify(missingPrPage) },
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Review gate could not evaluate");
    expect(result.stderr).toContain("next PR-comment page");
    expect(attempts).toBe(2);
  });

  it.each([
    ["http-429", "gh: HTTP 429: too many requests\n"],
    ["http-500", "gh: HTTP 500: internal server error\n"],
    ["http-502", "gh: HTTP 502: bad gateway\n"],
    ["http-504", "gh: HTTP 504: gateway timeout\n"],
    ["rate-limit", "gh: API rate limit exceeded\n"],
    ["timeout", "gh: request timed out\n"],
    ["connection-reset", "gh: read: connection reset by peer\n"],
    ["dns", "gh: dial tcp: lookup api.github.com: no such host\n"],
  ])("retries the allowed %s transient failure", (_name, stderr) => {
    const fixture = reviewFixture({
      headRefOid: "head-sha",
      reviews: [review({ state: "COMMENTED", commit: "head-sha" })],
    });
    const { result, attempts } = runGateWithFakeGh([
      { status: 1, stderr },
      { status: 0, stdout: JSON.stringify(fixture) },
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Retrying in 0ms");
    expect(attempts).toBe(2);
  });

  it.each([
    [
      "transient retry exhaustion",
      [
        { status: 1, stderr: "gh: Service Unavailable (HTTP 503)\n" },
        { status: 1, stderr: "gh: Service Unavailable (HTTP 503)\n" },
        { status: 1, stderr: "gh: Service Unavailable (HTTP 503)\n" },
      ],
      3,
      "failed after 3 attempts",
      3,
    ],
    [
      "non-transient failure",
      [
        {
          status: 1,
          stderr: "gh: GraphQL: Could not resolve to a Repository with the name pack\n",
        },
      ],
      3,
      "Could not resolve to a Repository",
      1,
    ],
  ])("fails closed for %s", (_name, responses, retryAttempts, message, expectedAttempts) => {
    const { result, attempts } = runGateWithFakeGh(responses, retryAttempts);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Review gate could not evaluate");
    expect(result.stderr).toContain(message);
    expect(attempts).toBe(expectedAttempts);
  });

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

  it("clears stale requested-changes reviews when the current head has a later comment", () => {
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

  it("keeps commitless requested-changes reviews blocking after a current-head comment", () => {
    const fixturePath = writeFixture(
      "commitless-requested-changes",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({ state: "CHANGES_REQUESTED", commit: null }),
          review({ state: "COMMENTED", commit: "head-sha" }),
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

  it("fails when the evaluated PR head does not match the expected SHA", () => {
    const fixturePath = writeFixture(
      "head-mismatch",
      reviewFixture({
        headRefOid: "changed-sha",
        reviews: [review({ state: "COMMENTED", commit: "changed-sha" })],
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
        "--expected-head-oid",
        "older-sha",
      ]),
    ).toThrow(/PR head changed while evaluating/);
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

  it("does not let another author satisfy strict mode without an explicit author", () => {
    const fixturePath = writeFixture(
      "other-author-current-head-review",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({
            state: "COMMENTED",
            commit: "head-sha",
            author: "external-reviewer",
          }),
        ],
      }),
    );

    const result = spawnSync(
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
      ],
      { cwd: rootDir, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No review was found for current head");
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

  it("keeps current-head requested changes blocking after a stale approval", () => {
    const fixturePath = writeFixture(
      "requested-changes-then-stale-approval",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({
            state: "CHANGES_REQUESTED",
            commit: "head-sha",
            submittedAt: "2026-06-24T17:45:40Z",
          }),
          review({
            state: "APPROVED",
            commit: "old-sha",
            submittedAt: "2026-06-24T17:55:40Z",
          }),
        ],
      }),
    );

    expect(() =>
      execFileSync(
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
      ),
    ).toThrow(/Requested-changes reviews/);
  });

  it("allows a stale approval to clear an older requested-changes review", () => {
    const fixturePath = writeFixture(
      "old-request-approved-before-head",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({
            state: "CHANGES_REQUESTED",
            commit: "old-sha",
            submittedAt: "2026-06-24T17:45:40Z",
          }),
          review({
            state: "APPROVED",
            commit: "old-sha",
            submittedAt: "2026-06-24T17:55:40Z",
          }),
          review({
            state: "COMMENTED",
            commit: "head-sha",
            submittedAt: "2026-06-24T18:05:40Z",
          }),
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

  it("keeps requested changes blocking when a later comment is dismissed", () => {
    const fixturePath = writeFixture(
      "requested-changes-comment-dismissed",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({
            state: "CHANGES_REQUESTED",
            commit: "head-sha",
            submittedAt: "2026-06-24T17:45:40Z",
          }),
          review({ state: "COMMENTED", commit: "head-sha", submittedAt: "2026-06-24T17:50:40Z" }),
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
    ).toThrow(/Requested-changes reviews/);
  });

  it("ignores dismissed requested-changes reviews after an approval", () => {
    const fixturePath = writeFixture(
      "approval-then-dismissed-requested-changes",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({
            state: "APPROVED",
            commit: "head-sha",
            submittedAt: "2026-06-24T17:45:40Z",
          }),
          review({ state: "DISMISSED", commit: "head-sha", submittedAt: "2026-06-24T18:05:40Z" }),
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

  it("ignores dismissed requested-changes reviews after a comment", () => {
    const fixturePath = writeFixture(
      "comment-then-dismissed-requested-changes",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({ state: "COMMENTED", commit: "head-sha", submittedAt: "2026-06-24T17:45:40Z" }),
          review({ state: "DISMISSED", commit: "head-sha", submittedAt: "2026-06-24T18:05:40Z" }),
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

  it("treats only dismissed and pending reviews as no submitted head review", () => {
    const fixturePath = writeFixture(
      "only-dismissed-pending",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [
          review({ state: "DISMISSED", commit: "head-sha", submittedAt: "2026-06-24T17:55:40Z" }),
          review({ state: "PENDING", commit: "head-sha", submittedAt: "2026-06-24T18:05:40Z" }),
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
    expect(output).toContain("review-gate:allowed-missing-head-review");
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
        // Real process scheduling and fixture reads can consume a 5ms deadline (#200).
        "1000",
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

  it("fails closed when no current-head review arrives before the wait expires", () => {
    const firstFixture = writeFixture(
      "no-current-head-review-first",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [review({ state: "COMMENTED", commit: "old-sha" })],
      }),
    );
    const secondFixture = writeFixture(
      "no-current-head-review-second",
      reviewFixture({
        headRefOid: "head-sha",
        reviews: [review({ state: "COMMENTED", commit: "old-sha" })],
      }),
    );

    let failure: { status?: number | null; stderr?: string } | undefined;
    try {
      execFileSync(
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
          // Keep the per-test wait realistic under shared CPU load (#200).
          "1000",
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
    } catch (error) {
      failure = error as { status?: number | null; stderr?: string };
    }

    expect(failure?.status).toBe(1);
    expect(failure?.stderr).toContain("No review was found for current head");
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
  comments = [],
  commentsPageInfo = { hasNextPage: false, endCursor: null },
  reviewThreads = [],
  reviewThreadsPageInfo = { hasNextPage: false, endCursor: null },
  reviews,
  reviewsPageInfo = { hasNextPage: false, endCursor: null },
}: {
  headRefOid: string;
  headRefName?: string;
  baseRefName?: string;
  headRepository?: { nameWithOwner: string };
  body?: string;
  comments?: unknown[];
  commentsPageInfo?: { hasNextPage: boolean; endCursor: string | null };
  reviewThreads?: unknown[];
  reviewThreadsPageInfo?: { hasNextPage: boolean; endCursor: string | null };
  reviews: Array<ReturnType<typeof review>>;
  reviewsPageInfo?: { hasNextPage: boolean; endCursor: string | null };
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
          comments: {
            nodes: comments,
            pageInfo: commentsPageInfo,
          },
          reviewThreads: { nodes: reviewThreads, pageInfo: reviewThreadsPageInfo },
          reviews: { nodes: reviews, pageInfo: reviewsPageInfo },
        },
      },
    },
  };
}

function prFindingComment(
  options: {
    id?: string;
    isMinimized?: boolean;
    minimizedReason?: string | null;
    author?: string;
    body?: string;
  } = {},
) {
  const {
    id = "comment-1",
    isMinimized = false,
    minimizedReason = null,
    author = "chatgpt-codex-connector[bot]",
    body = "![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat) Fix this.",
  } = options;
  return {
    id,
    url: `https://github.com/lamemustafa/pack/pull/14#issuecomment-${id}`,
    createdAt: "2026-08-17T12:00:00Z",
    isMinimized,
    minimizedReason,
    author: { login: author },
    body,
  };
}

function durableDispositionComment(
  findingId: string,
  disposition: string,
  followUp: string | null = null,
) {
  return {
    id: `disposition-${findingId}`,
    url: `https://github.com/lamemustafa/pack/pull/14#issuecomment-disposition-${findingId}`,
    createdAt: "2026-08-17T12:30:00Z",
    isMinimized: false,
    minimizedReason: null,
    author: { login: "maintainer" },
    authorAssociation: "MEMBER",
    body: `<!-- review-gate-disposition:${JSON.stringify({
      findingId,
      disposition,
      ...(followUp ? { followUp } : {}),
    })} -->

Finding: ${findingId}
Disposition: ${disposition}
Evidence: reviewed against the source and current behaviour.${disposition === "rejected" ? "\nReasoning: source evidence disproves the finding." : ""}${followUp ? `\nFollow-up: ${followUp}` : ""}`,
  };
}

function runGateFixture(name: string, comments: unknown[], body = packPrBody()) {
  const fixture = writeFixture(
    `pr-finding-${name.replaceAll(" ", "-")}`,
    reviewFixture({
      headRefOid: "head-sha",
      body,
      comments,
      reviews: [review({ state: "COMMENTED", commit: "head-sha" })],
    }),
  );
  return spawnSync(
    process.execPath,
    [scriptPath, "--repo", "lamemustafa/pack", "--pr", "14", "--fixture", fixture],
    { cwd: rootDir, encoding: "utf8" },
  );
}

function runGateWithFakeGh(
  responses: Array<{ status: number; stdout?: string; stderr?: string }>,
  retryAttempts = responses.length,
) {
  const directory = mkdtempSync(path.join(tmpdir(), "pack-review-gate-gh-"));
  const statePath = path.join(directory, "attempts.txt");
  const fakeGhPath = path.join(directory, "gh");
  const fakeGhSource = `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const responses = ${JSON.stringify(responses)};
const statePath = ${JSON.stringify(statePath)};
const attempt = existsSync(statePath) ? Number(readFileSync(statePath, "utf8")) : 0;
writeFileSync(statePath, String(attempt + 1), "utf8");
const response = responses[Math.min(attempt, responses.length - 1)];
if (response.stdout) process.stdout.write(response.stdout);
if (response.stderr) process.stderr.write(response.stderr);
process.exit(response.status);
`;
  writeFileSync(fakeGhPath, fakeGhSource, "utf8");
  chmodSync(fakeGhPath, 0o755);

  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--repo",
      "lamemustafa/pack",
      "--pr",
      "14",
      "--retry-backoff-ms",
      "0",
      "--retry-attempts",
      String(retryAttempts),
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}` },
    },
  );

  return { result, attempts: Number(readFileSync(statePath, "utf8")) };
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

function review({
  state,
  commit,
  submittedAt = "2026-06-24T17:45:40Z",
  author = "chatgpt-codex-connector",
}: {
  state: "APPROVED" | "COMMENTED" | "CHANGES_REQUESTED" | "DISMISSED" | "PENDING";
  commit: string | null;
  submittedAt?: string;
  author?: string;
}) {
  return {
    state,
    submittedAt,
    url: `https://github.com/lamemustafa/pack/pull/14#${commit}-${state}`,
    author: { login: author },
    commit: commit ? { oid: commit } : null,
  };
}
