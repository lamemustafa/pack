#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const MAX_DURABLE_HISTORY_NODES = 20;
const MAX_DURABLE_REVIEW_STATE_BYTES = 60_000;
const EXIT_VERDICTS = new Map([
  [0, { conclusion: "success", title: "Scheduled review gate passed" }],
  [1, { conclusion: "failure", title: "Scheduled review gate found blocking review state" }],
  [2, { conclusion: "action_required", title: "Scheduled review gate could not evaluate" }],
]);
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
    publishCheck(pr.head.sha, evaluation.exitCode, evaluation.reviewState);
  }

  console.log(`Scheduled Review gate evaluated ${selected.length} pull request(s).`);
}

function evaluatePullRequest(pr) {
  const stateDirectory = mkdtempSync(join(tmpdir(), "pack-review-gate-state-"));
  const previousStatePath = join(stateDirectory, "previous.json");
  const nextStatePath = join(stateDirectory, "next.json");
  const evaluator = fileURLToPath(new URL("./check-pr-review-gate.mjs", import.meta.url));
  try {
    writeFileSync(previousStatePath, loadLatestDurableReviewState(pr), "utf8");
    const result = spawnSync(
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
        "180000",
        "--poll-interval-ms",
        "10000",
        "--allow-missing-head-review",
        "--expected-head-oid",
        pr.head.sha,
        "--review-state",
        previousStatePath,
        "--write-review-state",
        nextStatePath,
      ],
      { encoding: "utf8", env: process.env },
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    const exitCode = [0, 1, 2].includes(result.status) ? result.status : 2;
    const reviewState = exitCode === 2 ? null : serialiseNextReviewState(nextStatePath);
    return { exitCode, reviewState };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Review gate durable state could not evaluate: ${detail}`);
    return { exitCode: 2, reviewState: null };
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
}

function loadLatestDurableReviewState(pr) {
  const forcePushedPriorShas = loadForcePushedPriorShas(pr.number);
  const pendingShas = [pr.head.sha, ...forcePushedPriorShas];
  const visitedShas = new Set();

  while (pendingShas.length > 0) {
    if (visitedShas.size >= MAX_DURABLE_HISTORY_NODES) {
      throw new Error("durable review-state history exceeded the safe lookup bound");
    }
    const sha = pendingShas.shift();
    if (!/^[0-9a-f]{40}$/iu.test(sha ?? "") || visitedShas.has(sha)) continue;
    visitedShas.add(sha);
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
    for (const page of flattenPages(checkPages)) {
      for (const check of page?.check_runs ?? []) {
        if (
          check?.name === CHECK_RUN_NAME &&
          typeof check.output?.text === "string" &&
          check.output.text.startsWith(DURABLE_REVIEW_STATE_PREFIX) &&
          durableReviewStateBelongsToPr(check.output.text, pr.number)
        ) {
          return check.output.text;
        }
      }
    }

    const commit = JSON.parse(
      runGithub(
        ["api", "repos/" + repo + "/commits/" + sha],
        "durable review-state ancestry lookup",
      ),
    );
    if (!Array.isArray(commit?.parents)) {
      throw new Error("durable review-state commit ancestry is incomplete");
    }
    for (const parent of commit.parents) {
      if (!/^[0-9a-f]{40}$/iu.test(parent?.sha ?? "")) {
        throw new Error("durable review-state parent metadata is incomplete");
      }
      if (!visitedShas.has(parent.sha)) pendingShas.push(parent.sha);
    }
  }

  if (forcePushedPriorShas.length > 0) {
    throw new Error("force-push discontinuity left no reachable durable review state");
  }
  return JSON.stringify({ version: 1, prNumber: pr.number, findings: [] });
}

function durableReviewStateBelongsToPr(state, expectedPrNumber) {
  let parsed;
  try {
    parsed = JSON.parse(state.slice(DURABLE_REVIEW_STATE_PREFIX.length));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error("durable review state is malformed: " + detail);
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
  const priorShas = [];

  for (const event of flattenPages(timelinePages)) {
    if (event?.event !== "head_ref_force_pushed") continue;
    if (!/^[0-9a-f]{40}$/iu.test(event.before_commit_id ?? "")) {
      throw new Error("force-push event has no valid prior head SHA");
    }
    priorShas.push(event.before_commit_id);
  }

  return [...new Set(priorShas)];
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

function publishCheck(headSha, exitCode, reviewState = null) {
  const verdict = EXIT_VERDICTS.get(exitCode);
  if (!/^[0-9a-f]{40}$/iu.test(headSha)) fail("--head-sha must be a full commit SHA.");
  if (!verdict) fail("--exit-code must be 0, 1, or 2.");
  const summary =
    exitCode === 0
      ? "The review gate evaluated the pull request head and found no blocking state."
      : exitCode === 1
        ? "The review gate evaluated the pull request head and found a blocking state."
        : "The review gate could not evaluate the complete pull request review state.";
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

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}
