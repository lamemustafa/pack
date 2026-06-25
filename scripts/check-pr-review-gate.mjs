#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const strictHeadReview = args.has("--strict-head-review");
const allowMissingHeadReview = args.has("--allow-missing-head-review");
const waitHeadReviewMs = readNonNegativeIntegerArg("--wait-head-review-ms", 0);
const pollIntervalMs = readNonNegativeIntegerArg("--poll-interval-ms", 10_000);
const fixturePaths = readFixturePaths();
const requiredReviewAuthor = readArgValue("--required-review-author");
const explicitRepo = readArgValue("--repo");
const explicitPr = readArgValue("--pr");
let fixtureIndex = 0;

const repo =
  explicitRepo ?? runText(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
const prNumber = Number(explicitPr ?? runText(["pr", "view", "--json", "number", "-q", ".number"]));

if (!repo || !repo.includes("/")) fail("Could not determine GitHub repo. Pass --repo owner/name.");
if (!Number.isInteger(prNumber) || prNumber < 1)
  fail("Could not determine PR number. Pass --pr <number>.");

const { pr, unresolvedThreads, blockingReviews, headReviews } = await fetchEvaluatedPr();
reportBlockingState({ unresolvedThreads, blockingReviews });

const missingHeadReview = strictHeadReview && headReviews.length === 0;
if (missingHeadReview) {
  const message = `No review was found for current head ${pr.headRefOid}.`;
  if (allowMissingHeadReview) {
    console.warn(`${message} Continuing because --allow-missing-head-review was set.`);
  } else {
    console.error(message);
  }
}

if (
  unresolvedThreads.length > 0 ||
  blockingReviews.length > 0 ||
  (missingHeadReview && !allowMissingHeadReview)
) {
  process.exit(1);
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
    const pr = result.data?.repository?.pullRequest;
    if (!pr) fail(`Could not fetch PR #${prNumber} from ${repo}.`);

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
  const authorStates = reduceSubmittedCurrentHeadReviewsByAuthor(pr.reviews.nodes, pr.headRefOid);
  const blockingReviews = Array.from(authorStates.values())
    .map((state) => state.blockingReview)
    .filter(Boolean);
  const headReviews = Array.from(authorStates.values())
    .map((state) => state.latestSubmittedReview)
    .filter(Boolean)
    .filter(
      (review) =>
        !requiredReviewAuthor ||
        normaliseAuthorLogin(review.author?.login) === normaliseAuthorLogin(requiredReviewAuthor),
    );
  return { unresolvedThreads, blockingReviews, headReviews };
}

function reduceSubmittedCurrentHeadReviewsByAuthor(reviews, headRefOid) {
  const authorStates = new Map();
  const currentHeadReviews = reviews
    .filter(
      (review) =>
        review.state !== "PENDING" &&
        (review.commit?.oid === headRefOid ||
          (review.state === "CHANGES_REQUESTED" && !review.commit?.oid)),
    )
    .sort(compareReviewSubmittedAt);

  for (const review of currentHeadReviews) {
    const author = normaliseAuthorLogin(review.author?.login) || "unknown";

    const previous = authorStates.get(author) ?? {
      latestSubmittedReview: null,
      latestNonBlockingReview: null,
      blockingReview: null,
    };

    if (review.state === "DISMISSED") {
      authorStates.set(author, {
        latestSubmittedReview: previous.latestNonBlockingReview,
        latestNonBlockingReview: previous.latestNonBlockingReview,
        blockingReview: null,
      });
      continue;
    }

    if (review.state === "CHANGES_REQUESTED") {
      authorStates.set(author, {
        latestSubmittedReview: review,
        latestNonBlockingReview: previous.latestNonBlockingReview,
        blockingReview: review,
      });
      continue;
    }

    if (review.state === "APPROVED") {
      authorStates.set(author, {
        latestSubmittedReview: review,
        latestNonBlockingReview: review,
        blockingReview: null,
      });
      continue;
    }

    if (review.state === "COMMENTED") {
      authorStates.set(author, {
        latestSubmittedReview: review,
        latestNonBlockingReview: review,
        blockingReview: previous.blockingReview,
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

function reportBlockingState({ unresolvedThreads, blockingReviews }) {
  if (unresolvedThreads.length > 0) {
    console.error(`Unresolved review threads on ${repo}#${prNumber}:`);
    for (const thread of unresolvedThreads) {
      const comment = thread.comments.nodes[0];
      console.error(`- ${thread.path}:${thread.line ?? "?"} ${comment?.url ?? thread.id}`);
      console.error(`  author: ${comment?.author?.login ?? "unknown"}`);
    }
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
  const mergedPr = merged.data?.repository?.pullRequest;
  if (!mergedPr) return merged;

  let reviewThreadsPageInfo = mergedPr.reviewThreads.pageInfo;
  while (reviewThreadsPageInfo?.hasNextPage) {
    const page = fetchReviewThreadsGraphPage(reviewThreadsPageInfo.endCursor);
    const pr = page.data?.repository?.pullRequest;
    if (!pr) break;
    mergedPr.reviewThreads.nodes.push(...pr.reviewThreads.nodes);
    reviewThreadsPageInfo = pr.reviewThreads.pageInfo;
    mergedPr.reviewThreads.pageInfo = reviewThreadsPageInfo;
  }

  let reviewsPageInfo = mergedPr.reviews.pageInfo;
  while (reviewsPageInfo?.hasNextPage) {
    const page = fetchReviewsGraphPage(reviewsPageInfo.endCursor);
    const pr = page.data?.repository?.pullRequest;
    if (!pr) break;
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
    "query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid reviewThreads(first:100){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated path line comments(first:1){nodes{url author{login} body}}}} reviews(first:100){pageInfo{hasNextPage endCursor} nodes{state submittedAt url author{login} commit{oid}}}}}}",
  ];
  return runJson(commandArgs);
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
  for (const page of remainingPages) {
    const pr = page.data?.repository?.pullRequest;
    if (!pr) continue;
    mergedPr.reviewThreads.nodes.push(...pr.reviewThreads.nodes);
    mergedPr.reviews.nodes.push(...pr.reviews.nodes);
    mergedPr.reviewThreads.pageInfo = pr.reviewThreads.pageInfo;
    mergedPr.reviews.pageInfo = pr.reviews.pageInfo;
  }
  return merged;
}

function annotateReviewHeadRef(result) {
  const pr = result?.data?.repository?.pullRequest;
  if (!pr) return result;
  pr.reviewThreads.pageInfo ??= { hasNextPage: false, endCursor: null };
  pr.reviews.pageInfo ??= { hasNextPage: false, endCursor: null };
  return result;
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
  if (!Number.isInteger(value) || value < 0) fail(`${name} must be a non-negative integer.`);
  return value;
}

function normaliseAuthorLogin(login) {
  return String(login ?? "").replace(/\[bot\]$/u, "");
}

function runText(commandArgs) {
  return execFileSync("gh", commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runJson(commandArgs) {
  return JSON.parse(runText(commandArgs));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
