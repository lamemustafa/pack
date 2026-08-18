#!/usr/bin/env node

import { readFileSync } from "node:fs";
import {
  DEFAULT_GH_RETRY_ATTEMPTS,
  DEFAULT_GH_RETRY_BACKOFF_MS,
  runGhText,
} from "./lib/github-cli-retry.mjs";

const BLOCKING_STATE_EXIT_CODE = 1;
const EVALUATION_FAILURE_EXIT_CODE = 2;
const DEFAULT_PR_FINDING_AUTHOR = "chatgpt-codex-connector";
const RESOLVED_MINIMIZED_REASON = "resolved";
const ALLOWED_MISSING_HEAD_REVIEW_MARKER = "review-gate:allowed-missing-head-review";
const CODEX_SEVERITY_BADGE_PATTERN =
  /!\[P[0-3] Badge\]\(https:\/\/img\.shields\.io\/badge\/P[0-3]-[^)\s]+\)/u;

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const strictHeadReview = args.has("--strict-head-review");
const allowMissingHeadReview = args.has("--allow-missing-head-review");
const waitHeadReviewMs = readNonNegativeIntegerArg("--wait-head-review-ms", 0);
const pollIntervalMs = readNonNegativeIntegerArg("--poll-interval-ms", 10_000);
const retryAttempts = readPositiveIntegerArg("--retry-attempts", DEFAULT_GH_RETRY_ATTEMPTS);
const retryBackoffMs = readNonNegativeIntegerArg("--retry-backoff-ms", DEFAULT_GH_RETRY_BACKOFF_MS);
const fixturePaths = readFixturePaths();
const requiredReviewAuthor = readArgValue("--required-review-author");
const prFindingAuthor = requiredReviewAuthor ?? DEFAULT_PR_FINDING_AUTHOR;
const expectedHeadOid = readArgValue("--expected-head-oid");
const explicitRepo = readArgValue("--repo");
const explicitPr = readArgValue("--pr");
let fixtureIndex = 0;

const repo =
  explicitRepo ?? runText(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
const prNumber = Number(explicitPr ?? runText(["pr", "view", "--json", "number", "-q", ".number"]));

if (!repo || !repo.includes("/"))
  failEvaluation("Could not determine GitHub repo. Pass --repo owner/name.");
if (!Number.isInteger(prNumber) || prNumber < 1)
  failEvaluation("Could not determine PR number. Pass --pr <number>.");

const { pr, unresolvedThreads, blockingReviews, blockingComments, headReviews } =
  await fetchEvaluatedPr();
const bodyIssues = evaluatePullRequestBody(pr);
reportBlockingState({ unresolvedThreads, blockingReviews, blockingComments });

const missingHeadReview = strictHeadReview && headReviews.length === 0;
if (missingHeadReview) {
  const message = `No review was found for current head ${pr.headRefOid}.`;
  if (allowMissingHeadReview) {
    console.log(ALLOWED_MISSING_HEAD_REVIEW_MARKER);
    console.warn(`${message} Continuing because --allow-missing-head-review was set.`);
  } else {
    console.error(message);
  }
}

if (
  unresolvedThreads.length > 0 ||
  blockingReviews.length > 0 ||
  blockingComments.length > 0 ||
  bodyIssues.length > 0 ||
  (missingHeadReview && !allowMissingHeadReview)
) {
  if (bodyIssues.length > 0) {
    console.error(`PR body workflow/template issues on ${repo}#${prNumber}:`);
    for (const issue of bodyIssues) console.error(`- ${issue}`);
  }
  process.exit(BLOCKING_STATE_EXIT_CODE);
}

const latestReview = pr.reviews.nodes.at(-1);
if (latestReview && latestReview.commit?.oid !== pr.headRefOid) {
  console.warn(
    `Latest review is for ${latestReview.commit?.oid ?? "unknown"}, current head is ${pr.headRefOid}. Re-review may be needed.`,
  );
}

console.log(`PR review gate passed for ${repo}#${prNumber}.`);

async function fetchEvaluatedPr() {
  const start = Date.now();

  while (true) {
    const result = fetchReviewGraph();
    const pr = result?.data?.repository?.pullRequest;
    if (!pr) failEvaluation(`Could not fetch PR #${prNumber} from ${repo}.`);
    if (expectedHeadOid && pr.headRefOid !== expectedHeadOid) {
      failEvaluation(
        `PR head changed while evaluating ${repo}#${prNumber}: expected ${expectedHeadOid}, found ${pr.headRefOid}.`,
      );
    }

    const evaluated = evaluatePullRequestReviewState(pr);
    if (
      !strictHeadReview ||
      evaluated.headReviews.length > 0 ||
      waitHeadReviewMs <= 0 ||
      Date.now() - start >= waitHeadReviewMs
    ) {
      return { pr, ...evaluated };
    }

    await sleep(Math.min(pollIntervalMs, waitHeadReviewMs));
  }
}

function evaluatePullRequestReviewState(pr) {
  const unresolvedThreads = pr.reviewThreads.nodes.filter(
    (thread) => !thread.isResolved && !thread.isOutdated,
  );
  const blockingComments = pr.comments.nodes.filter(
    (comment) =>
      (!comment.isMinimized || comment.minimizedReason !== RESOLVED_MINIMIZED_REASON) &&
      normaliseAuthorLogin(comment.author?.login) === normaliseAuthorLogin(prFindingAuthor) &&
      CODEX_SEVERITY_BADGE_PATTERN.test(comment.body ?? ""),
  );
  const authorStates = reduceSubmittedCurrentHeadReviewsByAuthor(pr.reviews.nodes, pr.headRefOid);
  const blockingReviews = Array.from(authorStates.values())
    .map((state) => state.blockingReview)
    .filter(Boolean);
  const headReviews = Array.from(authorStates.values())
    .map((state) => state.latestCurrentHeadReview)
    .filter(Boolean)
    .filter(
      (review) =>
        !requiredReviewAuthor ||
        normaliseAuthorLogin(review.author?.login) === normaliseAuthorLogin(requiredReviewAuthor),
    );
  return { unresolvedThreads, blockingReviews, blockingComments, headReviews };
}

function reduceSubmittedCurrentHeadReviewsByAuthor(reviews, headRefOid) {
  const authorStates = new Map();
  const submittedReviews = reviews
    .filter((review) => review.state !== "PENDING" && review.state !== "DISMISSED")
    .sort(compareReviewSubmittedAt);

  for (const review of submittedReviews) {
    const author = normaliseAuthorLogin(review.author?.login) || "unknown";

    const previous = authorStates.get(author) ?? {
      latestSubmittedReview: null,
      latestCurrentHeadReview: null,
      blockingReview: null,
    };
    const isCurrentHeadReview = review.commit?.oid === headRefOid;
    const latestCurrentHeadReview = isCurrentHeadReview ? review : previous.latestCurrentHeadReview;

    if (review.state === "CHANGES_REQUESTED") {
      authorStates.set(author, {
        latestSubmittedReview: review,
        latestCurrentHeadReview,
        blockingReview: review,
      });
      continue;
    }

    if (review.state === "APPROVED") {
      authorStates.set(author, {
        latestSubmittedReview: review,
        latestCurrentHeadReview,
        blockingReview:
          previous.blockingReview?.commit?.oid === headRefOid && !isCurrentHeadReview
            ? previous.blockingReview
            : null,
      });
      continue;
    }

    if (review.state === "COMMENTED") {
      authorStates.set(author, {
        latestSubmittedReview: review,
        latestCurrentHeadReview,
        blockingReview:
          isCurrentHeadReview &&
          previous.blockingReview?.commit?.oid &&
          previous.blockingReview.commit.oid !== headRefOid
            ? null
            : previous.blockingReview,
      });
    }
  }

  return authorStates;
}

function compareReviewSubmittedAt(left, right) {
  const leftTime = Date.parse(left.submittedAt ?? "");
  const rightTime = Date.parse(right.submittedAt ?? "");
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  return 0;
}

function evaluatePullRequestBody(pr) {
  const issues = [];
  const body = pr.body ?? "";

  if (pr.headRefName === "master" || pr.headRefName === "main") {
    if (pr.headRepository?.nameWithOwner && pr.headRepository.nameWithOwner !== repo) {
      console.warn(
        `warn: fork branch ${pr.headRepository.nameWithOwner}:${pr.headRefName} uses a protected branch name; treating it as external contributor input.`,
      );
    } else {
      issues.push(
        `PR head branch is ${pr.headRefName}; Pack PRs must not be opened from a protected base branch.`,
      );
    }
  } else if (pr.headRefName && !pr.headRefName.startsWith("tapish-codex/")) {
    console.warn(
      `warn: PR head branch ${pr.headRefName} does not use tapish-codex/<short-scope>; acceptable for forks only.`,
    );
  }

  for (const required of [
    "Pack Workflow Preflight",
    "Privacy And Data-Flow Impact",
    "Sensitive Surface Review",
    "Verification",
    "PR Review Follow-Up",
    "pnpm workflow:preflight",
  ]) {
    if (!body.includes(required)) {
      issues.push(`missing PR template section or checklist text: ${required}`);
    }
  }

  return issues;
}

function reportBlockingState({ unresolvedThreads, blockingReviews, blockingComments }) {
  if (unresolvedThreads.length > 0) {
    console.error(`Unresolved review threads on ${repo}#${prNumber}:`);
    for (const thread of unresolvedThreads) {
      const comment = thread.comments.nodes[0];
      console.error(`- ${thread.path}:${thread.line ?? "?"} ${comment?.url ?? thread.id}`);
      console.error(`  author: ${comment?.author?.login ?? "unknown"}`);
    }
  }

  if (blockingComments.length > 0) {
    console.error(`Unresolved PR-level review findings on ${repo}#${prNumber}:`);
    for (const comment of blockingComments) {
      console.error(`- ${comment.url ?? comment.id}`);
      console.error(`  author: ${comment.author?.login ?? "unknown"}`);
    }
    console.error(
      "Minimize each finding with GitHub Hide → Resolved after dispositioning it. The next scheduled Review gate run will clear the check; the change is not immediate.",
    );
  }

  if (blockingReviews.length > 0) {
    console.error(`Requested-changes reviews on ${repo}#${prNumber}:`);
    for (const review of blockingReviews) {
      console.error(`- ${review.author?.login ?? "unknown"} ${review.submittedAt} ${review.url}`);
    }
  }
}

function fetchReviewGraph() {
  const fixture = nextFixturePath();
  if (fixture) return normaliseFixtureReviewGraph(JSON.parse(readFileSync(fixture, "utf8")));

  return fetchPaginatedReviewGraph();
}

function fetchPaginatedReviewGraph() {
  const merged = fetchReviewGraphPage();
  const mergedPr = merged?.data?.repository?.pullRequest;
  if (!mergedPr) return merged;
  ensureReviewConnections(mergedPr);

  let reviewThreadsPageInfo = mergedPr.reviewThreads.pageInfo;
  while (reviewThreadsPageInfo?.hasNextPage) {
    const page = fetchReviewThreadsGraphPage(reviewThreadsPageInfo.endCursor);
    const pr = page?.data?.repository?.pullRequest;
    if (!pr) failEvaluation(`Could not fetch the next review-thread page for ${repo}#${prNumber}.`);
    ensureReviewConnections(pr);
    mergedPr.reviewThreads.nodes.push(...pr.reviewThreads.nodes);
    reviewThreadsPageInfo = pr.reviewThreads.pageInfo;
    mergedPr.reviewThreads.pageInfo = reviewThreadsPageInfo;
  }

  let commentsPageInfo = mergedPr.comments.pageInfo;
  while (commentsPageInfo?.hasNextPage) {
    const page = fetchCommentsGraphPage(commentsPageInfo.endCursor);
    const pr = page?.data?.repository?.pullRequest;
    if (!pr) failEvaluation(`Could not fetch the next PR-comment page for ${repo}#${prNumber}.`);
    ensureReviewConnections(pr);
    mergedPr.comments.nodes.push(...pr.comments.nodes);
    commentsPageInfo = pr.comments.pageInfo;
    mergedPr.comments.pageInfo = commentsPageInfo;
  }

  let reviewsPageInfo = mergedPr.reviews.pageInfo;
  while (reviewsPageInfo?.hasNextPage) {
    const page = fetchReviewsGraphPage(reviewsPageInfo.endCursor);
    const pr = page?.data?.repository?.pullRequest;
    if (!pr) failEvaluation(`Could not fetch the next review page for ${repo}#${prNumber}.`);
    ensureReviewConnections(pr);
    mergedPr.reviews.nodes.push(...pr.reviews.nodes);
    reviewsPageInfo = pr.reviews.pageInfo;
    mergedPr.reviews.pageInfo = reviewsPageInfo;
  }

  return annotateReviewHeadRef(merged);
}

function fetchReviewGraphPage() {
  const [owner, name] = repo.split("/");
  const commandArgs = [
    "api",
    "graphql",
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `number=${prNumber}`,
    "-f",
    "query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){body headRefName baseRefName headRepository{nameWithOwner} headRefOid comments(first:100){pageInfo{hasNextPage endCursor} nodes{id url createdAt isMinimized minimizedReason author{login} body}} reviewThreads(first:100){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated path line comments(first:1){nodes{url author{login} body}}}} reviews(first:100){pageInfo{hasNextPage endCursor} nodes{state submittedAt url author{login} commit{oid}}}}}}",
  ];
  return runJson(commandArgs);
}

function fetchCommentsGraphPage(after) {
  const [owner, name] = repo.split("/");
  return runJson([
    "api",
    "graphql",
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `number=${prNumber}`,
    "-F",
    `after=${after}`,
    "-f",
    "query=query($owner:String!,$name:String!,$number:Int!,$after:String!){repository(owner:$owner,name:$name){pullRequest(number:$number){comments(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id url createdAt isMinimized minimizedReason author{login} body}}}}}",
  ]);
}

function fetchReviewThreadsGraphPage(after) {
  const [owner, name] = repo.split("/");
  return runJson([
    "api",
    "graphql",
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `number=${prNumber}`,
    "-F",
    `after=${after}`,
    "-f",
    "query=query($owner:String!,$name:String!,$number:Int!,$after:String!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated path line comments(first:1){nodes{url author{login} body}}}}}}}",
  ]);
}

function fetchReviewsGraphPage(after) {
  const [owner, name] = repo.split("/");
  return runJson([
    "api",
    "graphql",
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `number=${prNumber}`,
    "-F",
    `after=${after}`,
    "-f",
    "query=query($owner:String!,$name:String!,$number:Int!,$after:String!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviews(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{state submittedAt url author{login} commit{oid}}}}}}",
  ]);
}

function nextFixturePath() {
  if (fixturePaths.length === 0) return null;
  const index = Math.min(fixtureIndex, fixturePaths.length - 1);
  fixtureIndex += 1;
  return fixturePaths[index];
}

function normaliseFixtureReviewGraph(fixture) {
  if (Array.isArray(fixture.pages)) {
    return annotateReviewHeadRef(mergeReviewGraphPages(fixture.pages));
  }
  return annotateReviewHeadRef(fixture);
}

function mergeReviewGraphPages(pages) {
  const [firstPage, ...remainingPages] = pages;
  if (!firstPage) return {};
  const merged = JSON.parse(JSON.stringify(firstPage));
  const mergedPr = merged.data?.repository?.pullRequest;
  if (!mergedPr) return merged;
  ensureReviewConnections(mergedPr);
  for (const page of remainingPages) {
    const pr = page.data?.repository?.pullRequest;
    if (!pr) continue;
    ensureReviewConnections(pr);
    mergedPr.comments.nodes.push(...pr.comments.nodes);
    mergedPr.reviewThreads.nodes.push(...pr.reviewThreads.nodes);
    mergedPr.reviews.nodes.push(...pr.reviews.nodes);
    mergedPr.comments.pageInfo = pr.comments.pageInfo;
    mergedPr.reviewThreads.pageInfo = pr.reviewThreads.pageInfo;
    mergedPr.reviews.pageInfo = pr.reviews.pageInfo;
  }
  return merged;
}

function annotateReviewHeadRef(result) {
  const pr = result?.data?.repository?.pullRequest;
  if (!pr) return result;
  ensureReviewConnections(pr);
  return result;
}

function ensureReviewConnections(pr) {
  pr.comments ??= { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
  pr.comments.nodes ??= [];
  pr.comments.pageInfo ??= { hasNextPage: false, endCursor: null };
  pr.reviewThreads ??= { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
  pr.reviewThreads.nodes ??= [];
  pr.reviewThreads.pageInfo ??= { hasNextPage: false, endCursor: null };
  pr.reviews ??= { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
  pr.reviews.nodes ??= [];
  pr.reviews.pageInfo ??= { hasNextPage: false, endCursor: null };
}

function readFixturePaths() {
  const singleFixture = readArgValue("--fixture");
  const fixtureSequence = readArgValue("--fixture-sequence");
  if (fixtureSequence) return fixtureSequence.split(",").filter(Boolean);
  return singleFixture ? [singleFixture] : [];
}

function readArgValue(name) {
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] : null;
}

function readNonNegativeIntegerArg(name, defaultValue) {
  const rawValue = readArgValue(name);
  if (rawValue === null) return defaultValue;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0)
    failEvaluation(`${name} must be a non-negative integer.`);
  return value;
}

function readPositiveIntegerArg(name, defaultValue) {
  const value = readNonNegativeIntegerArg(name, defaultValue);
  if (value < 1) failEvaluation(`${name} must be a positive integer.`);
  return value;
}

function normaliseAuthorLogin(login) {
  return String(login ?? "").replace(/\[bot\]$/u, "");
}

function runText(commandArgs) {
  try {
    return runGhText(commandArgs, {
      attempts: retryAttempts,
      backoffMs: retryBackoffMs,
      operation: "evaluation",
    });
  } catch (error) {
    failEvaluation(formatErrorMessage(error));
  }
}

function runJson(commandArgs) {
  const output = runText(commandArgs);
  try {
    return JSON.parse(output);
  } catch (error) {
    failEvaluation(`GitHub CLI returned malformed JSON: ${formatErrorMessage(error)}`);
  }
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function failEvaluation(message) {
  console.error(`Review gate could not evaluate: ${message}`);
  process.exit(EVALUATION_FAILURE_EXIT_CODE);
}

function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
