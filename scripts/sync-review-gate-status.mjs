#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const REQUIRED_TEMPLATE_TEXT = [
  "Pack Workflow Preflight",
  "opened from a Pack branch, not master",
  "latest master Pack AGENTS guidance",
  "required Pack privacy/review/verification checklist visible",
  "Sanchika Adoption Gate",
  "docs/adoption-pack.md",
  "ComplyEaze and Axal completion evidence",
];

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const repo = readArgValue("--repo") ?? process.env.GITHUB_REPOSITORY;
const explicitPr = readArgValue("--pr");
const allOpen = args.has("--all-open");
const runUrl = readArgValue("--run-url");
const waitHeadReviewMs = readNonNegativeIntegerArg("--wait-head-review-ms", 0);
const pollIntervalMs = readNonNegativeIntegerArg("--poll-interval-ms", 10_000);
const strictHeadReview = args.has("--strict-head-review");
const allowMissingHeadReview = args.has("--allow-missing-head-review");
const skipPendingStatus = args.has("--skip-pending-status");
const requiredReviewAuthor = readArgValue("--required-review-author");
const ALLOWED_MISSING_HEAD_REVIEW_MARKER = "review-gate:allowed-missing-head-review";

if (!repo || !repo.includes("/")) fail("Pass --repo owner/name.");
if (!allOpen && (!explicitPr || !Number.isInteger(Number(explicitPr)))) {
  fail("Pass --pr <number> or --all-open.");
}

const targets = allOpen ? listOpenPullRequests() : [readPullRequest(Number(explicitPr))];
let targetedFailure = false;

for (const target of targets) {
  if (target.state && target.state !== "OPEN") {
    console.log(`Skipping PR #${target.number} because it is ${target.state}.`);
    continue;
  }

  if (!skipPendingStatus) {
    setReviewGateStatus(target, "pending", "Review gate is evaluating review state.");
  }
  const preflightResult = runPackPreflight(target);
  const result = runReviewGate(target.number);

  if (preflightResult.ok && result.ok) {
    if (result.allowedMissingHeadReview) {
      const statusOptions = allOpen
        ? {
            onlyIfLatestState: "success",
            skipIfStatusUnreadable: true,
          }
        : {};
      console.log(
        allOpen
          ? `Clearing stale Review gate success for #${target.number} if the current-head review is still missing.`
          : `Writing Review gate failure for #${target.number} because the current-head review is still missing.`,
      );
      setReviewGateStatus(
        target,
        "failure",
        "Required current-head review is missing.",
        statusOptions,
      );
      targetedFailure = true;
      continue;
    }

    setReviewGateStatus(target, "success", "No current-head review blockers found.");
    continue;
  }

  setReviewGateStatus(
    target,
    "failure",
    "Workflow preflight, unresolved thread, requested changes, or missing current-head review found.",
  );
  targetedFailure = true;
}

if (!allOpen && targetedFailure) process.exit(1);

function readPullRequest(number) {
  return runJson([
    "pr",
    "view",
    String(number),
    "--repo",
    repo,
    "--json",
    "number,headRefOid,headRefName,baseRefName,headRepository,state",
  ]);
}

function listOpenPullRequests() {
  const [owner, name] = repo.split("/");
  const pullRequests = [];
  let after = null;

  while (true) {
    const page = runJson([
      "api",
      "graphql",
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      ...(after ? ["-F", `after=${after}`] : []),
      "-f",
      after
        ? "query=query($owner:String!,$name:String!,$after:String!){repository(owner:$owner,name:$name){pullRequests(states:OPEN,first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{number headRefOid headRefName baseRefName headRepository{nameWithOwner}}}}}"
        : "query=query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(states:OPEN,first:100){pageInfo{hasNextPage endCursor} nodes{number headRefOid headRefName baseRefName headRepository{nameWithOwner}}}}}",
    ]);
    const pageData = page.data?.repository?.pullRequests;
    if (!pageData) fail(`Could not list open pull requests for ${repo}.`);

    pullRequests.push(...pageData.nodes);
    if (!pageData.pageInfo?.hasNextPage) return pullRequests;
    after = pageData.pageInfo.endCursor;
  }
}

function runPackPreflight(target) {
  const issues = [];
  const headRepository = target.headRepository?.nameWithOwner;
  const headRefName = target.headRefName;
  const baseRefName = target.baseRefName ?? "master";

  if (!headRefName) issues.push(`could not resolve PR #${target.number} head branch`);
  if (!headRepository) issues.push(`could not resolve PR #${target.number} head repository`);

  if (headRefName === "master" || headRefName === "main") {
    if (headRepository === repo) {
      issues.push(`PR #${target.number} uses protected branch ${headRefName}`);
    }
  } else if (headRefName && !headRefName.startsWith("tapish-codex/")) {
    console.warn(
      `warn: PR #${target.number} branch ${headRefName} does not use tapish-codex/<short-scope>; acceptable for forks only`,
    );
  }

  const template = headRepository
    ? readPullRequestFile(headRepository, target.headRefOid, ".github/PULL_REQUEST_TEMPLATE.md")
    : null;
  if (!template) {
    issues.push(`PR #${target.number} is missing .github/PULL_REQUEST_TEMPLATE.md`);
  } else {
    for (const required of REQUIRED_TEMPLATE_TEXT) {
      if (!template.includes(required)) {
        issues.push(
          `PR #${target.number} template is missing required Pack workflow checklist text: ${required}`,
        );
      }
    }
  }

  if (baseRefName !== "master") {
    console.warn(
      `warn: PR #${target.number} targets ${baseRefName}; Pack release gates expect master.`,
    );
  }

  for (const issue of issues) console.error(`error: ${issue}`);
  return { ok: issues.length === 0 };
}

function readPullRequestFile(repository, ref, filePath) {
  try {
    const file = runJson(["api", `repos/${repository}/contents/${filePath}?ref=${ref}`]);
    if (file.type !== "file" || typeof file.content !== "string") return null;
    return Buffer.from(file.content.replaceAll("\n", ""), "base64").toString("utf8");
  } catch (error) {
    process.stderr.write(String(error.stderr ?? ""));
    return null;
  }
}

function runReviewGate(prNumber) {
  const gateArgs = [
    fileURLToPath(new URL("./check-pr-review-gate.mjs", import.meta.url)),
    "--repo",
    repo,
    "--pr",
    String(prNumber),
    "--wait-head-review-ms",
    String(waitHeadReviewMs),
    "--poll-interval-ms",
    String(pollIntervalMs),
  ];

  if (strictHeadReview) gateArgs.push("--strict-head-review");
  if (allowMissingHeadReview) gateArgs.push("--allow-missing-head-review");
  if (requiredReviewAuthor) {
    gateArgs.push("--required-review-author", requiredReviewAuthor);
  }

  try {
    const output = execFileSync(process.execPath, gateArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    process.stdout.write(output);
    return {
      ok: true,
      allowedMissingHeadReview: output.includes(ALLOWED_MISSING_HEAD_REVIEW_MARKER),
    };
  } catch (error) {
    const failure = error;
    process.stdout.write(String(failure.stdout ?? ""));
    process.stderr.write(String(failure.stderr ?? ""));
    return { ok: false, allowedMissingHeadReview: false };
  }
}

function setReviewGateStatus(target, state, description, options = {}) {
  let latestStatus = null;
  try {
    latestStatus = readLatestReviewGateStatus(target);
  } catch (error) {
    if (options.skipIfStatusUnreadable) {
      console.warn(
        `warn: could not read existing Review gate status for #${target.number}; skipping ${state} status write.`,
      );
      process.stderr.write(String(error.stderr ?? ""));
      return;
    }
    console.warn(
      `warn: could not read existing Review gate status for #${target.number}; writing ${state} status anyway.`,
    );
    process.stderr.write(String(error.stderr ?? ""));
  }
  if (options.onlyIfLatestState && latestStatus?.state !== options.onlyIfLatestState) {
    console.log(
      `Review gate status is not ${options.onlyIfLatestState} for #${target.number}; skipping ${state} status write.`,
    );
    return;
  }
  if (latestStatus?.state === state && latestStatus?.description === description) {
    console.log(
      `Review gate status already ${state} for #${target.number}; skipping duplicate write.`,
    );
    return;
  }

  runText([
    "api",
    "-X",
    "POST",
    `repos/${repo}/statuses/${target.headRefOid}`,
    "-f",
    `state=${state}`,
    "-f",
    "context=Review gate",
    "-f",
    `description=${description}`,
    ...(runUrl ? ["-f", `target_url=${runUrl}`] : []),
  ]);
}

function readLatestReviewGateStatus(target) {
  const statuses = runJson(["api", `repos/${repo}/commits/${target.headRefOid}/statuses`]);
  return statuses.find((status) => status.context === "Review gate") ?? null;
}

function readArgValue(name) {
  const index = rawArgs.indexOf(name);
  if (index === -1) return undefined;
  const value = rawArgs[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function readNonNegativeIntegerArg(name, fallback) {
  const rawValue = readArgValue(name);
  if (rawValue === undefined) return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0) fail(`${name} must be a non-negative integer.`);
  return value;
}

function runJson(ghArgs) {
  return JSON.parse(runText(ghArgs));
}

function runText(ghArgs) {
  return execFileSync("gh", ghArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
