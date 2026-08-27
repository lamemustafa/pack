#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import {
  DEFAULT_GH_RETRY_ATTEMPTS,
  DEFAULT_GH_RETRY_BACKOFF_MS,
  runGhText,
} from "./lib/github-cli-retry.mjs";

const BLOCKING_STATE_EXIT_CODE = 1;
const EVALUATION_FAILURE_EXIT_CODE = 2;
const DEFAULT_PR_FINDING_AUTHOR = "chatgpt-codex-connector";
const RESOLVED_MINIMIZED_REASON = "resolved";
const DURABLE_REVIEW_STATE_PREFIX = "review-gate-state/v1\n";
const DURABLE_DISPOSITIONS = new Set([
  "open",
  "resolved",
  "fixed",
  "stale",
  "rejected",
  "linked-follow-up",
]);
const TRUSTED_DISPOSITION_ASSOCIATIONS = new Set(["MEMBER", "OWNER", "COLLABORATOR"]);
const DURABLE_DISPOSITION_MARKER = "<!-- review-gate-disposition:";
const ALLOWED_MISSING_HEAD_REVIEW_MARKER = "review-gate:allowed-missing-head-review";
const CODEX_SEVERITY_BADGE_PATTERN =
  /!\[P[0-3] Badge\]\(https:\/\/img\.shields\.io\/badge\/P[0-3]-[^)\s]+\)/u;
const CODEX_CLEAN_TOP_LEVEL_REVIEW_PATTERN =
  /^Codex Review: Didn't find any major issues\.[^\r\n]*(?:\r?\n)+[\s\S]*?\*\*Reviewed commit:\*\*\s*`([0-9a-f]{10,64})`/u;

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const strictHeadReview = args.has("--strict-head-review");
const allowMissingHeadReview = args.has("--allow-missing-head-review");
const waitHeadReviewMs = readNonNegativeIntegerArg("--wait-head-review-ms", 0);
const pollIntervalMs = readNonNegativeIntegerArg("--poll-interval-ms", 10_000);
const retryAttempts = readPositiveIntegerArg("--retry-attempts", DEFAULT_GH_RETRY_ATTEMPTS);
const retryBackoffMs = readNonNegativeIntegerArg("--retry-backoff-ms", DEFAULT_GH_RETRY_BACKOFF_MS);
const fixturePaths = readFixturePaths();
const requestedReviewAuthor = readArgValue("--required-review-author");
const requiredReviewAuthor = strictHeadReview
  ? (requestedReviewAuthor ?? DEFAULT_PR_FINDING_AUTHOR)
  : requestedReviewAuthor;
const prFindingAuthor = requestedReviewAuthor ?? DEFAULT_PR_FINDING_AUTHOR;
const expectedHeadOid = readArgValue("--expected-head-oid");
const explicitRepo = readArgValue("--repo");
const explicitPr = readArgValue("--pr");
const reviewStatePath = readArgValue("--review-state");
const nextReviewStatePath = readArgValue("--write-review-state");
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
const durableReviewState = readDurableReviewState(reviewStatePath, prNumber);
const reconciledDurableReviewState = reconcileDurableReviewState(durableReviewState, pr);
const durablyObservedBlockingComments = findDurablyObservedBlockingComments(
  reconciledDurableReviewState,
  pr.comments.nodes,
);
const bodyIssues = evaluatePullRequestBody(pr);
writeDurableReviewState(nextReviewStatePath, reconciledDurableReviewState);
reportBlockingState({
  unresolvedThreads,
  blockingReviews,
  blockingComments,
  durablyObservedBlockingComments,
});

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
  durablyObservedBlockingComments.length > 0 ||
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
  const cleanTopLevelReviews = strictHeadReview
    ? pr.comments.nodes.filter((comment) =>
        isTrustedCurrentHeadCodexTopLevelReview(comment, pr.headRefOid),
      )
    : [];
  const cleanTopLevelReviewAuthors = new Set(
    cleanTopLevelReviews.map((comment) => normaliseAuthorLogin(comment.author?.login)),
  );
  const blockingReviews = Array.from(authorStates.entries())
    .map(([author, state]) => ({ author, review: state.blockingReview }))
    .filter(
      ({ author, review }) =>
        review &&
        !(
          cleanTopLevelReviewAuthors.has(author) &&
          review.commit?.oid &&
          review.commit.oid !== pr.headRefOid
        ),
    )
    .map(({ review }) => review);
  const headReviews = Array.from(authorStates.values())
    .map((state) => state.latestCurrentHeadReview)
    .filter(Boolean)
    .filter(
      (review) =>
        !requiredReviewAuthor ||
        normaliseAuthorLogin(review.author?.login) === normaliseAuthorLogin(requiredReviewAuthor),
    );
  return {
    unresolvedThreads,
    blockingReviews,
    blockingComments,
    headReviews: [...headReviews, ...cleanTopLevelReviews],
  };
}

function isTrustedCurrentHeadCodexTopLevelReview(comment, headRefOid) {
  if (comment.isMinimized) return false;
  if (normaliseAuthorLogin(comment.author?.login) !== normaliseAuthorLogin(requiredReviewAuthor)) {
    return false;
  }
  const match = (comment.body ?? "").trimStart().match(CODEX_CLEAN_TOP_LEVEL_REVIEW_PATTERN);
  const reviewedCommit = match?.[1]?.toLowerCase();
  return reviewedCommit !== undefined && headRefOid.toLowerCase().startsWith(reviewedCommit);
}

function readDurableReviewState(filePath, expectedPrNumber) {
  if (!filePath) return { version: 1, prNumber: expectedPrNumber, findings: [] };

  let parsed;
  try {
    const raw = readFileSync(filePath, "utf8");
    parsed = JSON.parse(
      raw.startsWith(DURABLE_REVIEW_STATE_PREFIX)
        ? raw.slice(DURABLE_REVIEW_STATE_PREFIX.length)
        : raw,
    );
  } catch (error) {
    failEvaluation(`Could not read durable review state: ${formatErrorMessage(error)}`);
  }

  if (
    !parsed ||
    parsed.version !== 1 ||
    parsed.prNumber !== expectedPrNumber ||
    !Array.isArray(parsed.findings)
  ) {
    failEvaluation("Durable review state has an unsupported shape.");
  }

  const findingIds = new Set();
  for (const finding of parsed.findings) {
    if (
      !finding ||
      typeof finding.commentId !== "string" ||
      finding.commentId.length === 0 ||
      typeof finding.author !== "string" ||
      normaliseAuthorLogin(finding.author) !== normaliseAuthorLogin(prFindingAuthor) ||
      typeof finding.createdAt !== "string" ||
      !Number.isFinite(Date.parse(finding.createdAt)) ||
      !DURABLE_DISPOSITIONS.has(finding.disposition) ||
      (["fixed", "stale", "rejected", "linked-follow-up"].includes(finding.disposition) &&
        (typeof finding.dispositionCommentId !== "string" ||
          finding.dispositionCommentId.length === 0)) ||
      (finding.sourceRevision !== undefined && !isValidTimestamp(finding.sourceRevision)) ||
      (finding.dispositionSourceRevision !== undefined &&
        !isValidTimestamp(finding.dispositionSourceRevision)) ||
      findingIds.has(finding.commentId)
    ) {
      failEvaluation("Durable review state contains an invalid finding.");
    }
    findingIds.add(finding.commentId);
  }

  return parsed;
}

function findDurablyObservedBlockingComments(reviewState, comments) {
  const visibleCommentIds = new Set(
    comments
      .filter(isPrFindingComment)
      .map((comment) => comment.id)
      .filter(Boolean),
  );
  return reviewState.findings.filter(
    (finding) => finding.disposition === "open" && !visibleCommentIds.has(finding.commentId),
  );
}

function reconcileDurableReviewState(reviewState, pr) {
  validatePersistedDurableDispositions(reviewState, pr);
  const findings = new Map(reviewState.findings.map((finding) => [finding.commentId, finding]));

  for (const comment of pr.comments.nodes.filter(isPrFindingComment)) {
    const existing = findings.get(comment.id);
    const sourceRevision = readSourceRevision(comment);
    const retainsTerminalDisposition =
      existing?.dispositionCommentId && existing.dispositionSourceRevision === sourceRevision;
    findings.set(comment.id, {
      commentId: comment.id,
      author: normaliseAuthorLogin(comment.author?.login),
      createdAt: existing?.createdAt ?? comment.createdAt,
      sourceRevision,
      disposition:
        comment.isMinimized && comment.minimizedReason === RESOLVED_MINIMIZED_REASON
          ? "resolved"
          : retainsTerminalDisposition
            ? existing.disposition
            : "open",
      ...(retainsTerminalDisposition
        ? {
            dispositionCommentId: existing.dispositionCommentId,
            dispositionSourceRevision: existing.dispositionSourceRevision,
          }
        : existing?.dispositionCommentId
          ? {
              dispositionCommentId: existing.dispositionCommentId,
              ...(existing.dispositionSourceRevision
                ? { dispositionSourceRevision: existing.dispositionSourceRevision }
                : {}),
            }
          : {}),
    });
  }

  for (const comment of pr.comments.nodes) {
    const disposition = readTrustedDurableDisposition(comment, pr.body);
    if (!disposition) continue;
    const finding = findings.get(disposition.findingId);
    if (!finding) {
      failEvaluation("A trusted durable disposition references an unknown finding.");
    }
    if (
      finding.dispositionCommentId === comment.id &&
      (!finding.sourceRevision || finding.dispositionSourceRevision !== finding.sourceRevision)
    ) {
      continue;
    }
    if (!finding.sourceRevision || disposition.sourceRevision !== finding.sourceRevision) continue;
    findings.set(disposition.findingId, {
      ...finding,
      disposition: disposition.disposition,
      dispositionCommentId: comment.id,
      dispositionSourceRevision: finding.sourceRevision,
    });
  }

  return { version: 1, prNumber, findings: [...findings.values()] };
}

function readSourceRevision(comment) {
  if (!isValidTimestamp(comment.updatedAt)) {
    failEvaluation("A visible PR-level finding has no valid GitHub update timestamp.");
  }
  return comment.updatedAt;
}

function isValidTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validatePersistedDurableDispositions(reviewState, pr) {
  const commentsById = new Map(pr.comments.nodes.map((comment) => [comment.id, comment]));
  for (const finding of reviewState.findings) {
    if (!finding.dispositionCommentId) continue;
    const comment = commentsById.get(finding.dispositionCommentId);
    const disposition = comment && readTrustedDurableDisposition(comment, pr.body);
    if (
      !disposition ||
      disposition.findingId !== finding.commentId ||
      disposition.disposition !== finding.disposition
    ) {
      failEvaluation("A stored durable disposition no longer has matching visible evidence.");
    }
  }
}

function readTrustedDurableDisposition(comment, prBody) {
  if (
    !TRUSTED_DISPOSITION_ASSOCIATIONS.has(comment.authorAssociation) ||
    !String(comment.body ?? "").includes(DURABLE_DISPOSITION_MARKER)
  ) {
    return null;
  }
  const markers = [
    ...String(comment.body).matchAll(/<!-- review-gate-disposition:([\s\S]*?)-->/gu),
  ];
  if (markers.length !== 1) {
    failEvaluation("A trusted durable disposition marker is malformed.");
  }
  const evidence = String(comment.body).replace(markers[0][0], "").trim();
  if (!evidence) {
    failEvaluation("A trusted durable disposition must include visible evidence.");
  }

  let value;
  try {
    value = JSON.parse(markers[0][1]);
  } catch (error) {
    failEvaluation(
      `A trusted durable disposition marker is malformed: ${formatErrorMessage(error)}`,
    );
  }
  if (
    !value ||
    typeof value.findingId !== "string" ||
    value.findingId.length === 0 ||
    !isValidTimestamp(value.sourceRevision) ||
    !["fixed", "stale", "rejected", "linked-follow-up"].includes(value.disposition)
  ) {
    failEvaluation("A trusted durable disposition marker has an unsupported shape.");
  }
  if (!hasFindingLinkedDispositionEvidence(evidence, value)) {
    failEvaluation(
      "A trusted durable disposition must include finding-linked, disposition-specific visible evidence.",
    );
  }
  if (
    value.disposition === "linked-follow-up" &&
    (typeof value.followUp !== "string" ||
      value.followUp.length === 0 ||
      !includesExactFollowUpReference(evidence, value.followUp) ||
      !includesExactFollowUpReference(String(prBody ?? ""), value.followUp))
  ) {
    failEvaluation("A linked follow-up disposition must name its follow-up in the PR body.");
  }
  return value;
}

function hasFindingLinkedDispositionEvidence(evidence, disposition) {
  return (
    includesVisibleEvidenceField(evidence, "Finding", disposition.findingId) &&
    includesVisibleEvidenceField(evidence, "Disposition", disposition.disposition) &&
    includesVisibleEvidenceField(evidence, "Source revision", disposition.sourceRevision) &&
    hasNonEmptyVisibleEvidenceField(evidence, "Evidence") &&
    (disposition.disposition !== "rejected" ||
      hasNonEmptyVisibleEvidenceField(evidence, "Reasoning"))
  );
}

function includesVisibleEvidenceField(text, fieldName, value) {
  const escapedFieldName = fieldName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    "(?:^|\\n)\\s*" + escapedFieldName + "\\s*:\\s*" + escapedValue + "\\s*(?:$|\\n)",
    "u",
  ).test(text);
}

function hasNonEmptyVisibleEvidenceField(text, fieldName) {
  const escapedFieldName = fieldName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp("(?:^|\\n)\\s*" + escapedFieldName + "\\s*:\\s*\\S[^\\n]*", "u").test(text);
}

function includesExactFollowUpReference(text, reference) {
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp("(^|[^\\w])" + escaped + "(?!\\w)", "u").test(text);
}

function writeDurableReviewState(filePath, reviewState) {
  if (!filePath) return;
  try {
    writeFileSync(filePath, JSON.stringify(reviewState), "utf8");
  } catch (error) {
    failEvaluation(`Could not write durable review state: ${formatErrorMessage(error)}`);
  }
}

function isPrFindingComment(comment) {
  return (
    normaliseAuthorLogin(comment.author?.login) === normaliseAuthorLogin(prFindingAuthor) &&
    CODEX_SEVERITY_BADGE_PATTERN.test(comment.body ?? "")
  );
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

function reportBlockingState({
  unresolvedThreads,
  blockingReviews,
  blockingComments,
  durablyObservedBlockingComments,
}) {
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

  if (durablyObservedBlockingComments.length > 0) {
    console.error(`Durably observed PR-level review findings on ${repo}#${prNumber}:`);
    for (const finding of durablyObservedBlockingComments) {
      console.error(`- ${finding.commentId}`);
      console.error(`  author: ${finding.author}`);
    }
    console.error(
      "The source comment is no longer visible; a trusted maintainer disposition or a prior Hide → Resolved record is required.",
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
    "query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){body headRefName baseRefName headRepository{nameWithOwner} headRefOid comments(first:100){pageInfo{hasNextPage endCursor} nodes{id url createdAt updatedAt isMinimized minimizedReason authorAssociation author{login} body}} reviewThreads(first:100){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated path line comments(first:1){nodes{url author{login} body}}}} reviews(first:100){pageInfo{hasNextPage endCursor} nodes{state submittedAt url author{login} commit{oid}}}}}}",
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
    "query=query($owner:String!,$name:String!,$number:Int!,$after:String!){repository(owner:$owner,name:$name){pullRequest(number:$number){comments(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id url createdAt updatedAt isMinimized minimizedReason authorAssociation author{login} body}}}}}",
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
