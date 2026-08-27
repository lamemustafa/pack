import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();
const scriptPath = path.join(rootDir, "scripts", "publish-review-gate-check.mjs");
const headSha = "a".repeat(40);

describe("PR-head Review gate check publisher", () => {
  it.each([
    [0, "success"],
    [1, "failure"],
    [2, "action_required"],
  ])("maps exit %i to the %s scheduled Review gate conclusion", (exitCode, conclusion) => {
    const { result, calls } = runPublisher(exitCode, [{ status: 0 }]);
    expect(result.status).toBe(0);
    const call = calls[0]?.join(" ") ?? "";
    expect(call).toContain("repos/lamemustafa/pack/check-runs");
    expect(call).toContain("name=Review gate (scheduled)");
    expect(call).toContain(`head_sha=${headSha}`);
    expect(call).toContain(`conclusion=${conclusion}`);
  });

  it.each([
    ["succeeds after retry", [1, 0], 0],
    ["reports exhaustion", [1, 1], 2],
  ])("%s for transient check publication", (_name, statuses, expectedExit) => {
    const responses = statuses.map((status) => ({
      status,
      stderr: status ? "gh: HTTP 503\n" : "",
    }));
    const { result, calls } = runPublisher(1, responses);
    expect(result.status).toBe(expectedExit);
    if (expectedExit === 2) expect(result.stderr).toContain("failed after 2 attempts");
    expect(calls).toHaveLength(2);
  });

  it("selects only open non-draft same-repository PRs and logs skips and the cap", () => {
    const pulls = [
      pull(1),
      pull(2, { draft: true }),
      pull(3, { state: "closed" }),
      pull(4, { headRepo: "external/pack" }),
      pull(5),
    ];
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      pulls,
      cleanReviewFixture(),
    );
    const publications = calls.filter((call) => call.includes("repos/lamemustafa/pack/check-runs"));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Skipping #2: pull request is a draft");
    expect(result.stdout).toContain("Skipping #3: pull request is not open");
    expect(result.stdout).toContain("Skipping #4: fork head external/pack");
    expect(result.stderr).toContain("schedule cap hit: processing 1 of 2 eligible");
    expect(publications).toHaveLength(1);
    expect(publications[0]).toContain(`head_sha=${headSha}`);
  });

  it("rotates the capped selection across eligible pull requests", () => {
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "1"],
      [pull(1), pull(2)],
      cleanReviewFixture(),
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));

    expect(result.status).toBe(0);
    expect(publication).toContain(`head_sha=${"2".repeat(40)}`);
  });

  it("prefers durable state anchored to the current head", () => {
    const orphanedSha = "b".repeat(40);
    const durableState = reviewStateWithDeletedFinding();
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      durableState,
      [{ status: 0 }],
      null,
      [forcePushEvent(orphanedSha)],
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const stateLookup = calls.find((call) => call.join(" ").includes("/check-runs?"));
    const publicationText = publication?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(stateLookup?.join(" ")).toContain("check_name=Review%20gate%20(scheduled)");
    expect(
      calls.some((call) => call.join(" ").includes(`commits/${orphanedSha}/check-runs?`)),
    ).toBe(false);
    expect(calls.some((call) => call.join(" ").includes("issues/1/timeline?"))).toBe(true);
    expect(publicationText).toContain("conclusion=failure");
    expect(publicationText).toContain("output[text]=review-gate-state/v1");
    expect(publicationText).toContain("comment-deleted-after-observation");
  });

  it("consults force-push prior heads before discarding durable state", () => {
    const orphanedSha = "b".repeat(40);
    const durableState = reviewStateWithDeletedFinding();
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      { [orphanedSha]: durableState },
      [forcePushEvent(orphanedSha)],
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const publicationText = publication?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(publicationText).toContain("conclusion=failure");
    expect(publicationText).toContain("comment-deleted-after-observation");
    expect(
      calls.some((call) => call.join(" ").includes(`commits/${orphanedSha}/check-runs?`)),
    ).toBe(true);
  });

  it("walks a force-pushed prior head ancestry to retain an older durable state", () => {
    const orphanedSha = "b".repeat(40);
    const intermediateSha = "c".repeat(40);
    const anchorSha = "d".repeat(40);
    const durableState = reviewStateWithDeletedFinding();
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      { [anchorSha]: durableState },
      [forcePushEvent(orphanedSha)],
      { [orphanedSha]: [intermediateSha], [intermediateSha]: [anchorSha] },
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));

    expect(result.status).toBe(0);
    expect(publication?.join(" ")).toContain("conclusion=failure");
    expect(calls.some((call) => call.join(" ").includes(`commits/${anchorSha}/check-runs?`))).toBe(
      true,
    );
  });

  it("returns current-head durable state before traversing ordinary PR ancestry", () => {
    const firstParentSha = "b".repeat(40);
    const durableState = reviewStateWithDeletedFinding();
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      durableState,
      [{ status: 0 }],
      null,
      [],
      { [headSha]: [firstParentSha] },
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const stateLookups = calls.filter((call) => call.join(" ").includes("/check-runs?"));

    expect(result.status).toBe(0);
    expect(stateLookups).toHaveLength(1);
    expect(calls.some((call) => call.join(" ").includes(`commits/${firstParentSha}`))).toBe(false);
    expect(publication?.join(" ")).toContain("conclusion=failure");
  });

  it("seeds a clean durable state for an unforced first run", () => {
    const firstParentSha = "b".repeat(40);
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      null,
      [],
      { [headSha]: [firstParentSha] },
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const stateLookups = calls.filter((call) => call.join(" ").includes("/check-runs?"));

    expect(result.status).toBe(0);
    expect(stateLookups).toHaveLength(1);
    expect(calls.some((call) => call.includes(`repos/lamemustafa/pack/commits/${headSha}`))).toBe(
      false,
    );
    expect(
      calls.some((call) => call.includes(`repos/lamemustafa/pack/commits/${firstParentSha}`)),
    ).toBe(false);
    expect(publication?.join(" ")).toContain("conclusion=success");
    expect(publication?.join(" ")).toContain("output[text]=review-gate-state/v1");
  });

  it("prefers the newest force-push state anchor", () => {
    const olderSha = "b".repeat(40);
    const newerSha = "c".repeat(40);
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      {
        [olderSha]: reviewStateWithDeletedFinding(1, "older-anchor"),
        [newerSha]: reviewStateWithDeletedFinding(1, "newer-anchor"),
      },
      [
        forcePushEvent(olderSha, "2026-08-17T12:00:00Z"),
        forcePushEvent(newerSha, "2026-08-17T12:01:00Z"),
      ],
      { [newerSha]: [], [olderSha]: [] },
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));

    expect(result.status).toBe(0);
    expect(publication?.join(" ")).toContain("newer-anchor");
    expect(publication?.join(" ")).not.toContain("older-anchor");
  });

  it("fails closed rather than exceeding the durable-history lookup bound", () => {
    const history = Array.from({ length: 20 }, (_, index) => index.toString(16).padStart(40, "0"));
    const parents: Record<string, string[]> = {};
    for (const [index, sha] of history.entries()) {
      const parent = history[index + 1];
      parents[sha] = parent === undefined ? [] : [parent];
    }
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      null,
      [forcePushEvent(history[0]!)],
      parents,
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const stateLookups = calls.filter((call) => call.join(" ").includes("/check-runs?"));

    expect(result.status).toBe(0);
    expect(stateLookups).toHaveLength(20);
    expect(publication?.join(" ")).toContain("conclusion=action_required");
  }, 10_000);

  it("fails closed when a force-push leaves no durable state reachable", () => {
    const orphanedSha = "b".repeat(40);
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      {},
      [forcePushEvent(orphanedSha)],
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const publicationText = publication?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(publicationText).toContain("conclusion=action_required");
    expect(publicationText).not.toContain("output[text]");
  });

  it("ignores a durable check state written for another pull request", () => {
    const foreignState = reviewStateWithDeletedFinding(2);
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      foreignState,
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const publicationText = publication?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(publicationText).toContain("conclusion=success");
    expect(publicationText).not.toContain("comment-deleted-after-observation");
  });

  it("publishes action required when durable-state lookup exhausts retries", () => {
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [
        { status: 1, stderr: "gh: HTTP 503\n" },
        { status: 1, stderr: "gh: HTTP 503\n" },
      ],
    );
    const stateLookups = calls.filter((call) => call.join(" ").includes("/check-runs?"));
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const publicationText = publication?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(stateLookups).toHaveLength(2);
    expect(publicationText).toContain("conclusion=action_required");
    expect(publicationText).not.toContain("output[text]");
  });

  it("publishes action required for malformed durable state", () => {
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      "review-gate-state/v1\nnot-json",
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const publicationText = publication?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(publicationText).toContain("conclusion=action_required");
    expect(publicationText).not.toContain("output[text]");
  });

  it("fails closed when the next durable state exceeds the check-run text bound", () => {
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      null,
      [],
      {},
      700,
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));

    expect(result.status).toBe(0);
    expect(publication?.join(" ")).toContain("conclusion=action_required");
    expect(publication?.join(" ")).not.toContain("output[text]");
  });

  it("preserves the event gate's current-head review wait for scheduled evaluation", () => {
    const script = readFileSync(scriptPath, "utf8");
    expect(script).toMatch(/"--wait-head-review-ms",\s*"180000"/u);
    expect(script).toMatch(/"--poll-interval-ms",\s*"10000"/u);
  });
});

function runPublisher(exitCode: number, responses: Array<{ status: number; stderr?: string }>) {
  return runScript(["--head-sha", headSha, "--exit-code", String(exitCode)], [], {}, responses);
}

function runScript(
  modeArgs: string[],
  pulls: unknown[] = [],
  fixture: unknown = {},
  responses: Array<{ status: number; stderr?: string }> = [{ status: 0 }],
  durableState: string | null = null,
  durableResponses: Array<{ status: number; stderr?: string }> = [{ status: 0 }],
  durableStates: Record<string, string> | null = null,
  timeline: unknown[] = [],
  parents: Record<string, string[]> = {},
  syntheticFindingCount = 0,
) {
  const directory = mkdtempSync(path.join(tmpdir(), "pack-review-publisher-"));
  const callsPath = path.join(directory, "calls.json");
  const fakeGhPath = path.join(directory, "gh");
  writeFileSync(fakeGhPath, fakeGhSource, "utf8");
  chmodSync(fakeGhPath, 0o755);
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--repo",
      "lamemustafa/pack",
      "--details-url",
      "https://github.com/lamemustafa/pack/actions/runs/1",
      ...modeArgs,
      "--retry-attempts",
      String(Math.max(responses.length, durableResponses.length)),
      "--retry-backoff-ms",
      "0",
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_CALLS: callsPath,
        FAKE_FIXTURE: JSON.stringify(fixture),
        FAKE_PULLS: JSON.stringify([pulls]),
        FAKE_RESPONSES: JSON.stringify(responses),
        FAKE_DURABLE_STATES: JSON.stringify(
          durableStates ?? (durableState ? { [headSha]: durableState } : {}),
        ),
        FAKE_DURABLE_RESPONSES: JSON.stringify(durableResponses),
        FAKE_TIMELINE: JSON.stringify(timeline),
        FAKE_PARENTS: JSON.stringify(parents),
        FAKE_SYNTHETIC_FINDING_COUNT: String(syntheticFindingCount),
      },
    },
  );
  const calls = existsSync(callsPath) ? readFileSync(callsPath, "utf8") : "[]";
  return { result, calls: JSON.parse(calls) as string[][] };
}

const fakeGhSource = `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const calls = existsSync(process.env.FAKE_CALLS) ? JSON.parse(readFileSync(process.env.FAKE_CALLS, "utf8")) : [];
calls.push(args); writeFileSync(process.env.FAKE_CALLS, JSON.stringify(calls), "utf8");
const text = args.join(" ");
if (text.includes("pulls?state=open")) process.stdout.write(process.env.FAKE_PULLS);
else if (text.includes("/pulls/") && text.includes("/commits?")) {
  const pulls = JSON.parse(process.env.FAKE_PULLS).flat();
  process.stdout.write(JSON.stringify([pulls.map((pull) => ({ sha: pull.head.sha }))]));
}
else if (text.includes("/issues/") && text.includes("/timeline?")) {
  process.stdout.write(JSON.stringify([JSON.parse(process.env.FAKE_TIMELINE)]));
}
else if (text.match(/\\/commits\\/[a-f0-9]{40}$/i)) {
  const sha = text.match(/commits\\/([a-f0-9]{40})$/i)?.[1];
  const parents = sha ? JSON.parse(process.env.FAKE_PARENTS)[sha] ?? [] : [];
  process.stdout.write(JSON.stringify({ parents: parents.map((parentSha) => ({ sha: parentSha })) }));
}
else if (text.includes("/check-runs?")) {
  const attempts = calls.filter((call) => call.join(" ").includes("/check-runs?")).length;
  const responses = JSON.parse(process.env.FAKE_DURABLE_RESPONSES);
  const response = responses[Math.min(attempts - 1, responses.length - 1)];
  if (response.stderr) process.stderr.write(response.stderr);
  if (response.status) process.exit(response.status);
  const sha = text.match(/commits\\/([a-f0-9]{40})\\/check-runs\\?/i)?.[1];
  const state = sha ? JSON.parse(process.env.FAKE_DURABLE_STATES)[sha] : null;
  process.stdout.write(JSON.stringify([{ check_runs: state ? [{ name: "Review gate (scheduled)", completed_at: "2026-08-17T12:00:00Z", output: { text: state } }] : [] }]));
}
else if (text.includes("graphql")) {
  const fixture = JSON.parse(process.env.FAKE_FIXTURE);
  const syntheticFindingCount = Number(process.env.FAKE_SYNTHETIC_FINDING_COUNT);
  const number = Number(args.find((arg) => arg.startsWith("number="))?.split("=")[1]);
  const pull = JSON.parse(process.env.FAKE_PULLS).flat().find((item) => item.number === number);
  if (syntheticFindingCount > 0) {
    fixture.data.repository.pullRequest.comments.nodes = Array.from({ length: syntheticFindingCount }, (_, index) => ({
      id: "comment-" + index,
      isMinimized: false,
      minimizedReason: null,
      author: { login: "chatgpt-codex-connector" },
      createdAt: "2026-08-17T12:00:00Z",
      body: "![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat) Finding.",
    }));
  }
  fixture.data.repository.pullRequest.headRefOid = pull.head.sha;
  fixture.data.repository.pullRequest.reviews.nodes[0].commit.oid = pull.head.sha;
  process.stdout.write(JSON.stringify(fixture));
}
else if (text.includes("check-runs")) {
  const attempts = calls.filter((call) => call.includes("repos/lamemustafa/pack/check-runs")).length;
  const responses = JSON.parse(process.env.FAKE_RESPONSES);
  const response = responses[Math.min(attempts - 1, responses.length - 1)];
  if (response.stderr) process.stderr.write(response.stderr);
  process.exit(response.status);
} else process.exit(1);
`;

function pull(
  number: number,
  { draft = false, state = "open", headRepo = "lamemustafa/pack" } = {},
) {
  const sha = number === 1 ? headSha : String(number).repeat(40);
  return {
    number,
    state,
    draft,
    head: { sha, repo: { full_name: headRepo } },
  };
}

function reviewStateWithDeletedFinding(
  prNumber = 1,
  commentId = "comment-deleted-after-observation",
) {
  return (
    "review-gate-state/v1\n" +
    JSON.stringify({
      version: 1,
      prNumber,
      findings: [
        {
          commentId,
          author: "chatgpt-codex-connector",
          createdAt: "2026-08-17T12:00:00Z",
          disposition: "open",
        },
      ],
    })
  );
}

function forcePushEvent(beforeCommitId: string, createdAt = "2026-08-17T12:00:00Z") {
  return {
    event: "head_ref_force_pushed",
    before_commit_id: beforeCommitId,
    created_at: createdAt,
  };
}

const cleanReviewFixture = () => ({
  data: {
    repository: {
      pullRequest: {
        body: "Pack Workflow Preflight\nPrivacy And Data-Flow Impact\nSensitive Surface Review\nVerification\nPR Review Follow-Up\npnpm workflow:preflight",
        headRefName: "tapish-codex/test",
        headRepository: { nameWithOwner: "lamemustafa/pack" },
        headRefOid: headSha,
        comments: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
        reviewThreads: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
        reviews: {
          nodes: [
            {
              state: "COMMENTED",
              submittedAt: "2026-08-18T00:00:00Z",
              author: { login: "chatgpt-codex-connector" },
              commit: { oid: headSha },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  },
});
