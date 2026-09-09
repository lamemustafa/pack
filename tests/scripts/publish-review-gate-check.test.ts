import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();
const scriptPath = path.join(rootDir, "scripts", "publish-review-gate-check.mjs");
const headSha = "a".repeat(40);
const baseSha = "e".repeat(40);

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

  it("carries durable state forward across ordinary PR commits", () => {
    const priorSha = "b".repeat(40);
    const durableState = reviewStateWithDeletedFinding(1, "current-line-state");
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      { [priorSha]: durableState },
      [],
      {},
      0,
      { 1: [priorSha, headSha] },
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));

    expect(result.status).toBe(0);
    expect(publication?.join(" ")).toContain("conclusion=failure");
    expect(publication?.join(" ")).toContain("current-line-state");
  });

  it("searches the complete current PR history before the force-push bound", () => {
    const currentHistory = Array.from({ length: 21 }, (_, index) =>
      index.toString(16).padStart(40, "0"),
    );
    const oldestSha = currentHistory[0]!;
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      { [oldestSha]: reviewStateWithDeletedFinding(1, "older-current-line-state") },
      [],
      {},
      0,
      { 1: [...currentHistory, headSha] },
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const stateLookups = calls.filter((call) => call.join(" ").includes("/check-runs?"));

    expect(result.status).toBe(0);
    expect(stateLookups).toHaveLength(22);
    expect(publication?.join(" ")).toContain("conclusion=failure");
    expect(publication?.join(" ")).toContain("older-current-line-state");
  });

  it("prefers current-line state before an older force-push anchor", () => {
    const currentLineSha = "b".repeat(40);
    const orphanedSha = "c".repeat(40);
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      {
        [currentLineSha]: reviewStateWithDeletedFinding(1, "current-line-state"),
        [orphanedSha]: reviewStateWithDeletedFinding(1, "orphaned-state"),
      },
      [forcePushEvent(orphanedSha)],
      {},
      0,
      { 1: [currentLineSha, headSha] },
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));

    expect(result.status).toBe(0);
    expect(publication?.join(" ")).toContain("current-line-state");
    expect(publication?.join(" ")).not.toContain("orphaned-state");
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

  it("searches newer force-push ancestry before older anchors", () => {
    const newerSha = "b".repeat(40);
    const newerAncestorSha = "c".repeat(40);
    const olderSha = "d".repeat(40);
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      {
        [newerAncestorSha]: reviewStateWithDeletedFinding(1, "newer-ancestor-state"),
        [olderSha]: reviewStateWithDeletedFinding(1, "older-anchor-state"),
      },
      [
        forcePushEvent(olderSha, "2026-08-17T12:00:00Z"),
        forcePushEvent(newerSha, "2026-08-17T12:01:00Z"),
      ],
      { [newerSha]: [newerAncestorSha] },
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));

    expect(result.status).toBe(0);
    expect(publication?.join(" ")).toContain("newer-ancestor-state");
    expect(publication?.join(" ")).not.toContain("older-anchor-state");
  });

  it("searches base-branch history below the branch point of a discarded head", () => {
    const orphanedSha = "b".repeat(40);
    const olderBaseSha = "f".repeat(40);
    const { calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      {},
      [forcePushEvent(orphanedSha)],
      { [orphanedSha]: [baseSha], [baseSha]: [olderBaseSha] },
    );

    // Durable state is only ever published on a pull request head. `baseSha` and everything
    // below it is base-branch history, which was never a head of this pull request, so a
    // lookup there can only ever miss. This is the traversal that exhausted the lookup bound.
    expect(
      calls.some((call) => call.join(" ").includes(`commits/${olderBaseSha}/check-runs?`)),
    ).toBe(false);
  });

  it("fails closed rather than exceeding the force-push history lookup bound", () => {
    const history = Array.from({ length: 22 }, (_, index) => index.toString(16).padStart(40, "0"));
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
    // Refused on the size of the line rather than by walking it: only the current head is
    // looked up before the bound rejects, so an oversized history costs one request, not one
    // per commit.
    expect(stateLookups).toHaveLength(1);
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
    expect(
      calls.some((call) => call.join(" ").includes(`commits/${orphanedSha}/check-runs?`)),
    ).toBe(true);
    expect(publicationText).toContain("conclusion=action_required");
    expect(publicationText).not.toContain("output[text]");
  });

  // A rewrite that records no `before_commit_id` never names the head it discarded. Reviews do:
  // each records the commit it was submitted against. Without this the state below is
  // unreachable, and the pull request is refused for want of state it actually has.
  it("reaches durable state on a head named only by a review", () => {
    const reviewedSha = "b".repeat(40);
    const createdSha = "c".repeat(40);
    const durableState = reviewStateWithDeletedFinding();
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      { [reviewedSha]: durableState },
      [forcePushEvent(null, "2026-08-17T12:00:00Z", createdSha)],
      {},
      0,
      null,
      {},
      { 1: [{ commit_id: reviewedSha, submitted_at: "2026-08-17T11:00:00Z" }] },
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));

    expect(result.status).toBe(0);
    expect(
      calls.some((call) => call.join(" ").includes(`commits/${reviewedSha}/check-runs?`)),
    ).toBe(true);
    expect(publication?.join(" ")).toContain("conclusion=failure");
  });

  // The created head is newer than the review that named the discarded one, and the newest
  // recorded state is the one that wins.
  it("prefers state on the newer created head over an older reviewed head", () => {
    const reviewedSha = "b".repeat(40);
    const createdSha = "c".repeat(40);
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      {
        [createdSha]: cleanDurableState(),
        [reviewedSha]: reviewStateWithDeletedFinding(1, "comment-on-older-head"),
      },
      [forcePushEvent(null, "2026-08-17T12:00:00Z", createdSha)],
      {},
      0,
      null,
      {},
      { 1: [{ commit_id: reviewedSha, submitted_at: "2026-08-17T11:00:00Z" }] },
    );
    const publicationText =
      calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"))?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(publicationText).not.toContain("comment-on-older-head");
    expect(publicationText).toContain("conclusion=success");
  });

  // The branch comparison is what bounds the search. A list GitHub truncated, or one whose tip
  // is not the head it was asked about, is a narrower search wearing the shape of a complete
  // one -- so each is refused rather than searched.
  it("fails closed when the discarded-line comparison was truncated", () => {
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
      {},
      0,
      null,
      {},
      {},
      { [orphanedSha]: { total_commits: 2, commits: [{ sha: orphanedSha }] } },
    );
    const publicationText =
      calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"))?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(publicationText).toContain("conclusion=action_required");
    expect(
      calls.some((call) => call.join(" ").includes(`commits/${orphanedSha}/check-runs?`)),
    ).toBe(false);
  });

  it("fails closed when the discarded-line comparison does not reach that head", () => {
    const orphanedSha = "b".repeat(40);
    const straySha = "c".repeat(40);
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      {},
      [forcePushEvent(orphanedSha)],
      {},
      0,
      null,
      {},
      {},
      { [orphanedSha]: { total_commits: 1, commits: [{ sha: straySha }] } },
    );
    const publicationText =
      calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"))?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(publicationText).toContain("conclusion=action_required");
  });

  it("publishes a durable-state workspace failure without its local path", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pack-review-gate-private-path-"));
    const privatePath = path.join(directory, "not-a-directory");
    writeFileSync(privatePath, "not a directory", "utf8");
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
      0,
      null,
      { TMPDIR: privatePath },
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const publicationText = publication?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(privatePath);
    expect(publicationText).toContain("conclusion=action_required");
    expect(publicationText).toContain("could not create temporary durable review state");
    expect(publicationText).not.toContain(privatePath);
  });

  it("publishes a durable-state API failure without its raw URL", () => {
    const rawUrl = "https://api.github.example/internal-review-state";
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 1, stderr: `GitHub API request failed: ${rawUrl}` }],
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const publicationText = publication?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(rawUrl);
    expect(publicationText).toContain("conclusion=action_required");
    expect(publicationText).toContain("could not retrieve durable review state");
    expect(publicationText).not.toContain(rawUrl);
  });

  // #342: the decisive case. release-please force-pushes leave `before_commit_id`
  // null, so the gate called the rewrite untraceable and refused -- but the same
  // timeline event carries `commit_id`, the head after the push, which is where the
  // orphaned durable state lives. Blocking every release pull request to protect
  // state that was reachable all along is the defect this closes.
  it("reaches durable state on a head named only by the force-push commit_id", () => {
    const orphanedSha = "b".repeat(40);
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      { [orphanedSha]: cleanDurableState() },
      [forcePushEvent(null, "2026-08-17T00:00:00Z", orphanedSha)],
    );
    const publicationText =
      calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"))?.join(" ") ?? "";

    expect(
      calls.some((call) => call.join(" ").includes(`commits/${orphanedSha}/check-runs?`)),
      "the orphaned head named by commit_id must be consulted",
    ).toBe(true);
    expect(result.status).toBe(0);
    expect(publicationText).not.toContain("GitHub did not record the prior head");
    expect(publicationText).toContain("conclusion=success");
  });

  // Continuity is recovered, not waived: state found through a recovered head is
  // still required to belong to this pull request.
  it("ignores recovered-head state that belongs to another pull request", () => {
    const orphanedSha = "b".repeat(40);
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      // An open finding, so adopting it would be visible as a blocking verdict rather than
      // needing the published bytes to be read for a prNumber.
      { [orphanedSha]: reviewStateWithDeletedFinding(2, "comment-owned-by-pr-2") },
      [forcePushEvent(null, "2026-08-17T00:00:00Z", orphanedSha)],
    );
    const publicationText =
      calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"))?.join(" ") ?? "";

    expect(
      calls.some((call) => call.join(" ").includes(`commits/${orphanedSha}/check-runs?`)),
    ).toBe(true);
    expect(result.status).toBe(0);
    expect(publicationText).not.toContain("comment-owned-by-pr-2");
    expect(publicationText).not.toContain("conclusion=failure");
  });

  // The other half of the premise: a rewrite with neither field usable must stay
  // untraceable. Whatever widening happens must not make this reachable.
  it("stays untraceable when neither before_commit_id nor commit_id is usable", () => {
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      { ["c".repeat(40)]: cleanDurableState() },
      [forcePushEvent(null, "2026-08-17T00:00:00Z", null)],
    );
    const publicationText =
      calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"))?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(publicationText).toContain("conclusion=action_required");
    expect(publicationText).toContain("GitHub did not record the prior head");
  });

  it("publishes a re-creation remedy instead of seeding state across an untraceable rewrite", () => {
    const orphanedSha = "b".repeat(40);
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      { [orphanedSha]: reviewStateWithDeletedFinding() },
      [forcePushEvent(null, "2026-08-17T00:00:00Z")],
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const publicationText = publication?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(
      calls.some((call) => call.join(" ").includes(`commits/${orphanedSha}/check-runs?`)),
    ).toBe(false);
    expect(publicationText).toContain("conclusion=action_required");
    expect(publicationText).toContain("GitHub did not record the prior head");
    expect(publicationText).toContain("Re-create the branch as described in #299");
    expect(publicationText).not.toContain("output[text]");
  });

  it("never discards an unreachable deleted finding across an untraceable rewrite", () => {
    const orphanedSha = "b".repeat(40);
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture({
        comments: [retiredContinuityMarker()],
      }),
      [{ status: 0 }],
      null,
      [{ status: 0 }],
      { [orphanedSha]: reviewStateWithDeletedFinding() },
      [forcePushEvent(null)],
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const publicationText = publication?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(publicationText).toContain("conclusion=action_required");
    expect(publicationText).toContain("review continuity cannot be verified");
    expect(publicationText).not.toContain("output[text]=review-gate-state/v1");
    expect(publicationText).not.toContain("comment-deleted-after-observation");
  });

  it("refuses a reachable durable state when an untraceable rewrite disconnected history", () => {
    // The state below is reachable on the current line and looks clean. It cannot contain a
    // finding that was observed and then deleted only on the head the rewrite discarded, so
    // accepting it would publish success while losing that ask. The guard must therefore run
    // before any state lookup, not after the loop that returns one.
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      cleanDurableState(),
      [{ status: 0 }],
      null,
      [forcePushEvent(null)],
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const publicationText = publication?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(publicationText).toContain("conclusion=action_required");
    expect(publicationText).toContain("review continuity cannot be verified");
    expect(publicationText).not.toContain("conclusion=success");
    expect(publicationText).not.toContain("output[text]=review-gate-state/v1");
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

  it("publishes the malformed-state reason instead of recovery guidance", () => {
    // No untraceable rewrite here: with one present the rewrite is itself the terminal reason,
    // so this fixture would not exercise an unrelated exit-2 at all. Precedence is pinned by
    // the test below.
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      "review-gate-state/v1\nnot-json",
      [{ status: 0 }],
      null,
      [],
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const publicationText = publication?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(publicationText).toContain("conclusion=action_required");
    expect(publicationText).toContain("durable review state is malformed");
    expect(publicationText).not.toContain("qualifying review of the current head");
    expect(publicationText).not.toContain("output[text]");
  });

  it("reports the untraceable rewrite ahead of a malformed durable state", () => {
    // Precedence introduced by hoisting the rewrite guard above the state lookup: when history
    // cannot be verified, no state is read, so the rewrite is the reason regardless of what the
    // state would have said.
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1", "--selection-offset", "0"],
      [pull(1)],
      cleanReviewFixture(),
      [{ status: 0 }],
      "review-gate-state/v1\nnot-json",
      [{ status: 0 }],
      null,
      [forcePushEvent(null)],
    );
    const publication = calls.find((call) => call.includes("repos/lamemustafa/pack/check-runs"));
    const publicationText = publication?.join(" ") ?? "";

    expect(result.status).toBe(0);
    expect(publicationText).toContain("conclusion=action_required");
    expect(publicationText).toContain("review continuity cannot be verified");
    expect(publicationText).not.toContain("durable review state is malformed");
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

  it("preserves the event gate's 180-second current-head review wait for scheduled evaluation", () => {
    const script = readFileSync(scriptPath, "utf8");
    expect(script).toMatch(/const REVIEW_WAIT_MS = "180000"/u);
    expect(script).toMatch(/"--wait-head-review-ms",\s*reviewWaitMs/u);
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
  prCommits: Record<number, string[]> | null = null,
  environment: Record<string, string> = {},
  reviews: Record<number, Array<{ commit_id: string; submitted_at: string }>> = {},
  compareOverrides: Record<string, unknown> = {},
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
        ...environment,
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
        FAKE_PR_COMMITS: JSON.stringify(prCommits),
        FAKE_REVIEWS: JSON.stringify(reviews),
        FAKE_COMPARE_OVERRIDES: JSON.stringify(compareOverrides),
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
else if (text.includes("/pulls/") && text.includes("/reviews?")) {
  const number = Number(text.match(/pulls\\/(\\d+)\\/reviews\\?/i)?.[1]);
  const reviews = JSON.parse(process.env.FAKE_REVIEWS)?.[number] ?? [];
  process.stdout.write(JSON.stringify([reviews]));
}
else if (text.includes("/pulls/") && text.includes("/commits?")) {
  const pulls = JSON.parse(process.env.FAKE_PULLS).flat();
  const number = Number(text.match(/pulls\\/(\\d+)\\/commits\\?/i)?.[1]);
  const configuredCommits = JSON.parse(process.env.FAKE_PR_COMMITS);
  const pull = pulls.find((item) => item.number === number);
  const shas = configuredCommits?.[number] ?? (pull ? [pull.head.sha] : []);
  process.stdout.write(JSON.stringify([shas.map((sha) => ({ sha }))]));
}
else if (text.includes("/issues/") && text.includes("/timeline?")) {
  process.stdout.write(JSON.stringify([JSON.parse(process.env.FAKE_TIMELINE)]));
}
else if (text.includes("/compare/")) {
  const match = text.match(/compare\\/([a-f0-9]{40})\\.\\.\\.([a-f0-9]{40})/i);
  const base = match?.[1]; const head = match?.[2];
  const parents = JSON.parse(process.env.FAKE_PARENTS);
  const chain = []; let cursor = head;
  while (cursor && cursor !== base) {
    chain.push(cursor);
    const next = parents[cursor]?.[0];
    if (next === undefined) break;
    cursor = next;
  }
  const overrides = JSON.parse(process.env.FAKE_COMPARE_OVERRIDES)?.[head];
  const commits = chain.slice().reverse().map((sha) => ({ sha }));
  process.stdout.write(JSON.stringify(overrides ?? { total_commits: commits.length, commits }));
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
    base: { sha: baseSha },
  };
}

function cleanDurableState(prNumber = 1) {
  return "review-gate-state/v1\n" + JSON.stringify({ version: 1, prNumber, findings: [] });
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

function forcePushEvent(
  beforeCommitId: string | null,
  createdAt = "2026-08-17T12:00:00Z",
  commitId: string | null = null,
) {
  // Real events carry `commit_id` -- the head *after* the push -- even when
  // `before_commit_id` is null. Verified on #337, where all three release-please
  // force-pushes have a null `before_commit_id` and a populated `commit_id`.
  return {
    event: "head_ref_force_pushed",
    before_commit_id: beforeCommitId,
    ...(commitId === null ? {} : { commit_id: commitId }),
    created_at: createdAt,
  };
}

function retiredContinuityMarker() {
  return {
    id: "retired-continuity-marker",
    url: "https://github.com/lamemustafa/pack/pull/1#issuecomment-retired-continuity-marker",
    createdAt: "2026-08-17T12:30:00Z",
    updatedAt: "2026-08-17T12:30:00Z",
    isMinimized: false,
    minimizedReason: null,
    author: { login: "maintainer" },
    authorAssociation: "MEMBER",
    body: "<!-- review-gate-continuity-override:retired -->",
  };
}

type ReviewCommentFixture = ReturnType<typeof retiredContinuityMarker>;

const cleanReviewFixture = ({ comments = [] as ReviewCommentFixture[] } = {}) => ({
  data: {
    repository: {
      pullRequest: {
        body: "Pack Workflow Preflight\nPrivacy And Data-Flow Impact\nSensitive Surface Review\nVerification\nPR Review Follow-Up\npnpm workflow:preflight",
        headRefName: "tapish-codex/test",
        headRepository: { nameWithOwner: "lamemustafa/pack" },
        headRefOid: headSha,
        comments: {
          nodes: comments,
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
