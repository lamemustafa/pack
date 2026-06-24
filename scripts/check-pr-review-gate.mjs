#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const strictHeadReview = args.has("--strict-head-review");
const explicitRepo = readArgValue("--repo");
const explicitPr = readArgValue("--pr");

const repo =
  explicitRepo ?? runText(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
const prNumber = Number(explicitPr ?? runText(["pr", "view", "--json", "number", "-q", ".number"]));

if (!repo || !repo.includes("/")) fail("Could not determine GitHub repo. Pass --repo owner/name.");
if (!Number.isInteger(prNumber) || prNumber < 1)
  fail("Could not determine PR number. Pass --pr <number>.");

const [owner, name] = repo.split("/");
const result = runJson([
  "api",
  "graphql",
  "-F",
  `owner=${owner}`,
  "-F",
  `name=${name}`,
  "-F",
  `number=${prNumber}`,
  "-f",
  "query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid reviewThreads(first:100){nodes{id isResolved isOutdated path line comments(first:1){nodes{url author{login} body}}}} reviews(first:100){nodes{state submittedAt url author{login} commit{oid}}}}}}",
]);

const pr = result.data?.repository?.pullRequest;
if (!pr) fail(`Could not fetch PR #${prNumber} from ${repo}.`);

const unresolvedThreads = pr.reviewThreads.nodes.filter(
  (thread) => !thread.isResolved && !thread.isOutdated,
);
const blockingReviews = pr.reviews.nodes.filter((review) => review.state === "CHANGES_REQUESTED");
const headReviews = pr.reviews.nodes.filter((review) => review.commit?.oid === pr.headRefOid);

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

if (strictHeadReview && headReviews.length === 0) {
  console.error(`No review was found for current head ${pr.headRefOid}.`);
}

if (
  unresolvedThreads.length > 0 ||
  blockingReviews.length > 0 ||
  (strictHeadReview && headReviews.length === 0)
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

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
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
