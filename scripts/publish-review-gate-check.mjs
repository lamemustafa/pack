#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  DEFAULT_GH_RETRY_ATTEMPTS,
  DEFAULT_GH_RETRY_BACKOFF_MS,
  runGhText,
} from "./lib/github-cli-retry.mjs";

const CHECK_RUN_NAME = "Review gate (scheduled)";
const DURABLE_REVIEW_STATE_PREFIX = "review-gate-state/v1\n";
const MAX_DURABLE_FORCE_PUSH_HISTORY_NODES = 20;
const MAX_DURABLE_REVIEW_STATE_BYTES = 60_000;
const REVIEW_WAIT_MS = "180000";
const EXIT_VERDICTS = new Map([
  [0, { conclusion: "success", title: "Scheduled review gate passed" }],
  [1, { conclusion: "failure", title: "Scheduled review gate found blocking review state" }],
  [2, { conclusion: "action_required", title: "Scheduled review gate could not evaluate" }],
]);

class EvaluationOperationError extends Error {
  constructor(operation, error) {
    super(operation);
    this.operation = operation;
    this.detail = formatErrorMessage(error);
  }
}

const rawArgs = process.argv.slice(2);
const repo = readArg("--repo", true);
const detailsUrl = readArg("--details-url", true);
const retryAttempts = readIntegerArg("--retry-attempts", DEFAULT_GH_RETRY_ATTEMPTS, 1);
const retryBackoffMs = readIntegerArg("--retry-backoff-ms", DEFAULT_GH_RETRY_BACKOFF_MS, 0);
if (!repo.includes("/")) fail("--repo must be owner/name.");
try {
  if (rawArgs.includes("--reconcile-open-prs")) {
    reconcileOpenPullRequests();
  } else {
    publishCheck(readArg("--head-sha", true), Number(readArg("--exit-code", true)));
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  fail(`Review gate publication could not complete: ${detail}`, 2);
}
function reconcileOpenPullRequests() {
  const maxPrs = readIntegerArg("--max-prs", 25, 1);
  const selectionOffset = readIntegerArg(
    "--selection-offset",
    Math.floor(Date.now() / (15 * 60 * 1000)),
    0,
  );
  const pages = JSON.parse(
    runGithub(
      ["api", "--paginate", "--slurp", `repos/${repo}/pulls?state=open&per_page=100`],
      "pull request discovery",
    ),
  );
  const pulls = (Array.isArray(pages?.[0]) ? pages.flat() : pages).filter(Boolean);
  const eligible = [];

  for (const pr of pulls) {
    const label = `#${pr.number ?? "unknown"}`;
    const reason =
      String(pr.state).toLowerCase() !== "open"
        ? "pull request is not open"
        : pr.draft
          ? "pull request is a draft"
          : pr.head?.repo?.full_name !== repo
            ? `fork head ${pr.head?.repo?.full_name ?? "unknown"} cannot receive a trusted scheduled Review gate check`
            : !Number.isInteger(pr.number) || !/^[0-9a-f]{40}$/iu.test(pr.head?.sha ?? "")
              ? "pull request metadata is incomplete"
              : null;
    if (reason) console.log(`Skipping ${label}: ${reason}.`);
    else eligible.push(pr);
  }

  const start = eligible.length === 0 ? 0 : (selectionOffset * maxPrs) % eligible.length;
  const selected = [...eligible.slice(start), ...eligible.slice(0, start)].slice(0, maxPrs);
  if (eligible.length > maxPrs) {
    console.warn(
      `Review gate schedule cap hit: processing ${maxPrs} of ${eligible.length} eligible pull requests.`,
    );
  }

  for (const pr of selected) {
    const evaluation = evaluatePullRequest(pr);
    publishCheck(pr.head.sha, evaluation.exitCode, evaluation.reviewState, evaluation.safeMessage);
  }

  console.log(`Scheduled Review gate evaluated ${selected.length} pull request(s).`);
}

function evaluatePullRequest(pr) {
  let stateDirectory = null;
  const evaluator = fileURLToPath(new URL("./check-pr-review-gate.mjs", import.meta.url));
  try {
    stateDirectory = runEvaluationOperation("could not create temporary durable review state", () =>
      mkdtempSync(join(tmpdir(), "pack-review-gate-state-")),
    );
    const previousStatePath = join(stateDirectory, "previous.json");
    const nextStatePath = join(stateDirectory, "next.json");
    const evaluationErrorPath = join(stateDirectory, "evaluation-error.json");
    const durableState = runEvaluationOperation("could not retrieve durable review state", () =>
      loadLatestDurableReviewState(pr),
    );
    const reviewWaitMs = REVIEW_WAIT_MS;
    runEvaluationOperation("could not write durable review state", () =>
      writeFileSync(previousStatePath, durableState.reviewState, "utf8"),
    );
    const result = runEvaluationOperation("could not run the review evaluator", () =>
      runReviewEvaluator(
        process.execPath,
        [
          evaluator,
          "--repo",
          repo,
          "--pr",
          String(pr.number),
          "--strict-head-review",
          "--required-review-author",
          "chatgpt-codex-connector",
          "--wait-head-review-ms",
          reviewWaitMs,
          "--poll-interval-ms",
          "10000",
          "--allow-missing-head-review",
          "--expected-head-oid",
          pr.head.sha,
          "--review-state",
          previousStatePath,
          "--write-review-state",
          nextStatePath,
          "--write-evaluation-error",
          evaluationErrorPath,
        ],
        { encoding: "utf8", env: process.env },
      ),
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    const exitCode = [0, 1, 2].includes(result.status) ? result.status : 2;
    const reviewState =
      exitCode === 2
        ? null
        : runEvaluationOperation("could not read evaluator durable review state", () =>
            serialiseNextReviewState(nextStatePath),
          );
    return {
      exitCode,
      reviewState,
      safeMessage: exitCode === 2 ? readTerminalEvaluationError(evaluationErrorPath) : null,
    };
  } catch (error) {
    const safeMessage = evaluationSafeMessage(error);
    console.error(`Review gate ${safeMessage}: ${evaluationErrorDetail(error)}`);
    return {
      exitCode: 2,
      reviewState: null,
      safeMessage: `Review gate ${safeMessage}.`,
    };
  } finally {
    if (stateDirectory) {
      try {
        rmSync(stateDirectory, { force: true, recursive: true });
      } catch (error) {
        console.error(
          `Review gate could not remove temporary durable review state: ${formatErrorMessage(error)}`,
        );
      }
    }
  }
}

function runReviewEvaluator(command, args, options) {
  const result = spawnSync(command, args, options);
  if (result.error) throw result.error;
  return result;
}

function runEvaluationOperation(operation, callback) {
  try {
    return callback();
  } catch (error) {
    if (error instanceof EvaluationOperationError) throw error;
    throw new EvaluationOperationError(operation, error);
  }
}

function evaluationSafeMessage(error) {
  return error instanceof EvaluationOperationError
    ? error.operation
    : "could not complete durable review-state evaluation";
}

function evaluationErrorDetail(error) {
  return error instanceof EvaluationOperationError ? error.detail : formatErrorMessage(error);
}

function readTerminalEvaluationError(path) {
  if (!existsSync(path)) {
    return "Review evaluator exited without publishing a structured terminal error.";
  }
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (value?.version === 1 && typeof value.message === "string" && value.message.trim()) {
      return value.message;
    }
  } catch {
    // Publish the bounded generic reason below rather than an arbitrary file-read error.
  }
  return "Review evaluator published an invalid structured terminal error.";
}

function untraceableRewriteError() {
  return new EvaluationOperationError(
    "GitHub did not record the prior head, so review continuity cannot be verified across that rewrite. Re-create the branch as described in #299 before running the review gate",
    new Error("untraceable force-push discontinuity cannot be verified"),
  );
}

function loadLatestDurableReviewState(pr) {
  const { priorHeads: forcePushedPriorShas, hasUntraceableRewrite } = loadForcePushedPriorShas(
    pr.number,
  );
  // Reject before consulting any reachable state, not after. A state surviving on a current-line
  // commit cannot contain a finding that was observed and then deleted only on the head this
  // rewrite discarded, so returning it would publish success while losing that ask. Continuity
  // across a null `before_commit_id` cannot be proved, so no reachable state is trustworthy here.
  if (hasUntraceableRewrite) throw untraceableRewriteError();

  const currentPrShas = loadCurrentPrCommitShas(pr);
  if (forcePushedPriorShas.length === 0) {
    // Linear history. A commit stops being the head the moment the next one is pushed, and state
    // is only ever published against the head, so nothing can land on an older commit afterwards:
    // higher commit means newer state, and the first hit searching newest-first is the latest.
    const currentLineState = findFirstDurableState(currentPrShas, pr.number);
    return { reviewState: currentLineState?.text ?? cleanReviewState(pr.number) };
  }

  // A rewrite that records no `before_commit_id` never names the head it discarded, so the
  // force-push events alone do not enumerate every head this pull request has had. Reviews do
  // name them: each review records the `commit_id` it was submitted against. On #337 the first
  // regeneration's discarded head is named by nothing else, and it is the head that actually
  // carries this pull request's durable state.
  const priorHeads = dedupePriorHeadShas(forcePushedPriorShas, loadReviewedHeadShas(pr.number));
  const discardedLineShas = loadDiscardedLineShas(pr, priorHeads, new Set(currentPrShas));

  // Across a rewrite there is no commit order to read precedence from, and no timestamp attached
  // to a head is safe to infer it from: a review submitted after a force-push still records the
  // older commit it was started against, which would rank a discarded head above the newer one
  // that replaced it. So rank by the only recorded fact about the state itself -- when the gate
  // published it -- which means every candidate is read rather than stopping at the first hit.
  const states = collectDurableStates([...currentPrShas, ...discardedLineShas], pr.number);
  if (states.length > 0) return { reviewState: selectNewestDurableState(states) };

  throw new Error("force-push discontinuity left no reachable durable review state");
}

function selectNewestDurableState(states) {
  const ordered = [...states].sort((left, right) => right.recordedAt - left.recordedAt);
  const [newest, runnerUp] = ordered;
  // A tie between two different states is a precedence question with no recorded answer, and
  // guessing it can drop an ask that only the loser records.
  if (runnerUp && runnerUp.recordedAt === newest.recordedAt && runnerUp.text !== newest.text) {
    throw new Error("durable review states have ambiguous recording order");
  }
  return newest.text;
}

function dedupePriorHeadShas(forcePushedPriorHeads, reviewedHeads) {
  const seen = new Set();
  const shas = [];
  for (const head of [...forcePushedPriorHeads, ...reviewedHeads]) {
    if (seen.has(head.sha)) continue;
    seen.add(head.sha);
    shas.push(head.sha);
  }
  return shas;
}

function loadReviewedHeadShas(prNumber) {
  const reviewPages = JSON.parse(
    runGithub(
      ["api", "--paginate", "--slurp", `repos/${repo}/pulls/${prNumber}/reviews?per_page=100`],
      "reviewed head discovery",
    ),
  );
  const heads = [];
  for (const review of flattenPages(reviewPages)) {
    // Skipping an unusable entry only narrows what is searched; it can never accept state. The
    // refusal below still stands when nothing is found.
    if (!/^[0-9a-f]{40}$/iu.test(review?.commit_id ?? "")) continue;
    const at = Date.parse(review.submitted_at ?? "");
    heads.push({ sha: review.commit_id, at: Number.isFinite(at) ? at : 0 });
  }
  return heads;
}

function cleanReviewState(prNumber) {
  return JSON.stringify({ version: 1, prNumber, findings: [] });
}

// Durable state is published only against a pull request head -- `publishCheck` is always called
// with `pr.head.sha`. So the commits that can carry it are the heads this pull request has had:
// its current commits, and for a line a force-push discarded, the commits unique to that head
// against the base branch. Ancestry below the branch point is base-branch history, which was
// never a head here and can only ever miss. Walking into it is what exhausted the lookup bound on
// a release pull request whose discarded heads each sat directly on master (#337).
function loadDiscardedLineShas(pr, priorHeads, currentPrShaSet) {
  const baseSha = pr.base?.sha;
  if (!/^[0-9a-f]{40}$/iu.test(baseSha ?? "")) {
    throw new Error("pull request base metadata is incomplete");
  }
  const seen = new Set(currentPrShaSet);
  const shas = [];
  for (const head of priorHeads) {
    for (const sha of loadDiscardedLineForHead(baseSha, head)) {
      if (seen.has(sha)) continue;
      seen.add(sha);
      shas.push(sha);
      // Checked here rather than by the caller so the bound limits the work as well as the
      // result. Checked afterwards, an oversized history still costs one comparison request per
      // candidate head before anything refuses, which can exhaust the run that was supposed to
      // publish the fail-closed check.
      if (shas.length > MAX_DURABLE_FORCE_PUSH_HISTORY_NODES) {
        throw new Error("durable force-push history exceeded the safe lookup bound");
      }
    }
  }
  return shas;
}

function loadDiscardedLineForHead(baseSha, head) {
  const comparison = JSON.parse(
    runGithub(
      ["api", `repos/${repo}/compare/${baseSha}...${head}`],
      "durable review-state branch scope lookup",
    ),
  );
  const commits = comparison?.commits;
  if (!Array.isArray(commits)) {
    throw new Error("durable review-state branch comparison is incomplete");
  }
  // GitHub caps the inline commit list, and a truncated list would silently narrow the search
  // into a false proof of absence below.
  if (!Number.isInteger(comparison.total_commits) || comparison.total_commits > commits.length) {
    throw new Error("durable review-state branch comparison was truncated");
  }
  const shas = [];
  for (const commit of commits) {
    if (!/^[0-9a-f]{40}$/iu.test(commit?.sha ?? "")) {
      throw new Error("durable review-state branch comparison has an invalid commit SHA");
    }
    shas.push(commit.sha);
  }
  // The head is a candidate whether or not the comparison contributes commits: it is a head this
  // pull request had, and it can carry durable state. A base branch that has advanced to contain
  // it legitimately yields no head-only commits, and refusing that would discard reachable state.
  if (shas.length === 0) return [head];
  // When the comparison does contribute commits, the head must be their tip. If it is not, this
  // is not the line that was asked about, and searching it would be a narrower search wearing the
  // shape of a complete one.
  if (shas.at(-1) !== head) {
    throw new Error("durable review-state branch comparison did not reach the discarded head");
  }
  return shas.reverse();
}

function findFirstDurableState(shas, prNumber) {
  for (const sha of shas) {
    const [state] = readDurableStatesAt(sha, prNumber);
    if (state) return state;
  }
  return null;
}

function collectDurableStates(shas, prNumber) {
  const states = [];
  for (const sha of shas) states.push(...readDurableStatesAt(sha, prNumber));
  return states;
}

function readDurableStatesAt(sha, prNumber) {
  const checkPages = JSON.parse(
    runGithub(
      [
        "api",
        "--paginate",
        "--slurp",
        `repos/${repo}/commits/${sha}/check-runs?check_name=${encodeURIComponent(CHECK_RUN_NAME)}&filter=all&per_page=100`,
      ],
      "durable review-state lookup",
    ),
  );
  const states = [];
  for (const page of flattenPages(checkPages)) {
    for (const check of page?.check_runs ?? []) {
      if (
        check?.name !== CHECK_RUN_NAME ||
        typeof check.output?.text !== "string" ||
        !check.output.text.startsWith(DURABLE_REVIEW_STATE_PREFIX) ||
        !durableReviewStateBelongsToPr(check.output.text, prNumber)
      ) {
        continue;
      }
      const recordedAt = Date.parse(check.completed_at ?? "");
      // Recording order is how precedence is decided, so a state that cannot say when it was
      // recorded cannot be ranked against one that can.
      if (!Number.isFinite(recordedAt)) {
        throw new Error("durable review state has no valid recording timestamp");
      }
      states.push({ text: check.output.text, recordedAt });
    }
  }
  return states;
}

function loadCurrentPrCommitShas(pr) {
  const commitPages = JSON.parse(
    runGithub(
      ["api", "--paginate", "--slurp", `repos/${repo}/pulls/${pr.number}/commits?per_page=100`],
      "current pull request history discovery",
    ),
  );
  const shas = [];
  const seenShas = new Set();
  for (const commit of flattenPages(commitPages)) {
    if (!/^[0-9a-f]{40}$/iu.test(commit?.sha ?? "")) {
      throw new Error("current pull request history has an invalid commit SHA");
    }
    if (!seenShas.has(commit.sha)) {
      seenShas.add(commit.sha);
      shas.push(commit.sha);
    }
  }
  if (!seenShas.has(pr.head.sha)) {
    throw new Error("current pull request history does not contain the PR head");
  }
  return [pr.head.sha, ...shas.reverse().filter((sha) => sha !== pr.head.sha)];
}

function durableReviewStateBelongsToPr(state, expectedPrNumber) {
  let parsed;
  try {
    parsed = JSON.parse(state.slice(DURABLE_REVIEW_STATE_PREFIX.length));
  } catch (error) {
    throw new EvaluationOperationError("durable review state is malformed", error);
  }
  return parsed?.version === 1 && parsed.prNumber === expectedPrNumber;
}

function loadForcePushedPriorShas(prNumber) {
  const timelinePages = JSON.parse(
    runGithub(
      [
        "api",
        "--paginate",
        "--slurp",
        "-H",
        "Accept: application/vnd.github+json",
        `repos/${repo}/issues/${prNumber}/timeline?per_page=100`,
      ],
      "force-push discontinuity discovery",
    ),
  );
  const rewrites = [];
  let hasUntraceableRewrite = false;

  for (const event of flattenPages(timelinePages)) {
    if (event?.event !== "head_ref_force_pushed") continue;
    const createdAt = Date.parse(event.created_at ?? "");
    if (!Number.isFinite(createdAt)) {
      throw new Error("force-push event has no valid creation timestamp");
    }
    // `before_commit_id` is the discarded head and is what continuity wants. GitHub
    // omits it for every release-please regeneration, which is what made those
    // rewrites look untraceable and blocked release pull requests indefinitely
    // (#342). The same event still names `commit_id`, the head the push created, and
    // durable state published against either head is a check run addressable by its
    // SHA -- so both are candidate heads to search rather than evidence to discard.
    //
    // This recovers continuity; it does not waive it. State found this way is still
    // required to belong to this pull request, and a rewrite naming neither head
    // remains untraceable below.
    const shas = [event.commit_id, event.before_commit_id].filter((sha) =>
      /^[0-9a-f]{40}$/iu.test(sha ?? ""),
    );
    if (shas.length === 0) {
      hasUntraceableRewrite = true;
      continue;
    }
    rewrites.push({ createdAt, shas });
  }

  // Ordering is over events, not SHAs. Two SHAs from one event share its timestamp
  // and their order is known -- the created head is newer than the discarded one --
  // so only a tie between distinct events is genuinely ambiguous.
  rewrites.sort((left, right) => right.createdAt - left.createdAt);
  for (let index = 1; index < rewrites.length; index += 1) {
    if (rewrites[index - 1].createdAt === rewrites[index].createdAt) {
      throw new Error("force-push events have ambiguous chronological ordering");
    }
  }

  const seen = new Set();
  const priorHeads = [];
  for (const rewrite of rewrites) {
    for (const sha of rewrite.shas) {
      if (seen.has(sha)) continue;
      seen.add(sha);
      priorHeads.push({ sha, at: rewrite.createdAt });
    }
  }
  return { priorHeads, hasUntraceableRewrite };
}

function flattenPages(value) {
  if (!Array.isArray(value)) throw new Error("GitHub API returned malformed pagination data");
  return value.flat();
}

function serialiseNextReviewState(path) {
  const state = readFileSync(path, "utf8");
  if (!state) throw new Error("review evaluator did not write durable state");
  const serialised = DURABLE_REVIEW_STATE_PREFIX + state;
  if (Buffer.byteLength(serialised, "utf8") > MAX_DURABLE_REVIEW_STATE_BYTES) {
    throw new Error("durable review state exceeds the safe publication bound");
  }
  return serialised;
}

function publishCheck(headSha, exitCode, reviewState = null, safeMessage = null) {
  const verdict = EXIT_VERDICTS.get(exitCode);
  if (!/^[0-9a-f]{40}$/iu.test(headSha)) fail("--head-sha must be a full commit SHA.");
  if (!verdict) fail("--exit-code must be 0, 1, or 2.");
  const summary =
    exitCode === 0
      ? "The review gate evaluated the pull request head and found no blocking state."
      : exitCode === 1
        ? "The review gate evaluated the pull request head and found a blocking state."
        : (safeMessage ??
          "The review gate could not evaluate the complete pull request review state.");
  const fields = {
    name: CHECK_RUN_NAME,
    head_sha: headSha,
    status: "completed",
    conclusion: verdict.conclusion,
    details_url: detailsUrl,
    "output[title]": verdict.title,
    "output[summary]": summary,
  };
  if (reviewState) fields["output[text]"] = reviewState;
  const formArgs = Object.entries(fields).flatMap(([name, value]) => ["-f", `${name}=${value}`]);
  runGithub(
    [
      "api",
      "-X",
      "POST",
      `repos/${repo}/check-runs`,
      "-H",
      "X-GitHub-Api-Version: 2022-11-28",
      ...formArgs,
    ],
    "check publication",
  );
  console.log(`${CHECK_RUN_NAME} ${verdict.conclusion} check created for ${headSha}.`);
}

function runGithub(commandArgs, operation) {
  return runGhText(commandArgs, {
    attempts: retryAttempts,
    backoffMs: retryBackoffMs,
    operation,
  });
}

function readArg(name, required = false) {
  const index = rawArgs.indexOf(name);
  const value = index >= 0 ? rawArgs[index + 1] : null;
  if (required && (!value || value.startsWith("--"))) fail(`Pass ${name} <value>.`);
  return value;
}

function readIntegerArg(name, defaultValue, minimum) {
  const rawValue = readArg(name);
  if (rawValue === null) return defaultValue;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum) fail(`${name} must be at least ${minimum}.`);
  return value;
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}
