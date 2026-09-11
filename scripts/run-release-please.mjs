import { appendFile } from "node:fs/promises";
import {
  formatReleaseBranchRewriteMarker,
  readReleaseBranchRewriteMarker,
} from "./lib/release-branch-rewrite.mjs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const releasePlease = require("release-please");

const DEFAULT_CONFIG_FILE = "release-please-config.json";
const DEFAULT_MANIFEST_FILE = ".release-please-manifest.json";
const DEFAULT_GITHUB_API_URL = "https://api.github.com";
const DEFAULT_GITHUB_GRAPHQL_URL = "https://api.github.com";

export async function runReleasePlease(env = process.env) {
  const { GitHub, Manifest, VERSION } = releasePlease;
  const token = env.RELEASE_PLEASE_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN;
  const repoUrl = env.GITHUB_REPOSITORY;
  if (!token) throw new Error("Missing RELEASE_PLEASE_TOKEN, GITHUB_TOKEN, or GH_TOKEN.");
  if (!repoUrl) throw new Error("Missing GITHUB_REPOSITORY.");

  const [owner, repo] = repoUrl.split("/");
  if (!owner || !repo) throw new Error(`GITHUB_REPOSITORY must be owner/repo, got: ${repoUrl}`);

  console.log(`Running release-please version: ${VERSION}`);
  const github = await GitHub.create({
    owner,
    repo,
    token,
    apiUrl: env.GITHUB_API_URL || DEFAULT_GITHUB_API_URL,
    graphqlUrl: normalizeGraphqlUrl(env.GITHUB_GRAPHQL_URL || DEFAULT_GITHUB_GRAPHQL_URL),
    defaultBranch: env.RELEASE_PLEASE_TARGET_BRANCH,
  });
  const targetBranch = resolveReleaseTargetBranch(env, github.repository.defaultBranch);
  const configFile = env.RELEASE_PLEASE_CONFIG_FILE || DEFAULT_CONFIG_FILE;
  const manifestFile = env.RELEASE_PLEASE_MANIFEST_FILE || DEFAULT_MANIFEST_FILE;

  const releaseManifest = await Manifest.fromManifest(
    github,
    targetBranch,
    configFile,
    manifestFile,
  );
  // Before `createReleases()`, because everything here can fail and nothing here is reversible
  // once a GitHub release exists. A failure at this point costs a re-run; the same failure after a
  // release is published leaves that release without its assets.
  const headsBeforeRegeneration = await openBranchRewriteRecords({
    env,
    owner,
    repo,
    targetBranch,
  });

  const releases = (await releaseManifest.createReleases()).filter(Boolean);
  const outputs = buildReleaseOutputs(releases);

  const pullRequestManifest = await Manifest.fromManifest(
    github,
    targetBranch,
    configFile,
    manifestFile,
  );
  const pullRequests = (await pullRequestManifest.createPullRequests()).filter(Boolean);
  await closeBranchRewriteRecords({ env, owner, repo, targetBranch, headsBeforeRegeneration });
  outputs.prs_created = String(pullRequests.length > 0);
  if (pullRequests.length > 0) {
    outputs.pr = JSON.stringify(pullRequests[0]);
    outputs.prs = JSON.stringify(pullRequests);
  }

  if (env.GITHUB_OUTPUT) {
    await appendFile(env.GITHUB_OUTPUT, serializeGitHubOutput(outputs), "utf8");
  }

  console.log(
    `Release Please completed: releases_created=${outputs.releases_created}, prs_created=${outputs.prs_created}`,
  );

  return outputs;
}

// Release Please regenerates by force-pushing, and GitHub records no `before_commit_id` for it, so
// the discarded head is unnameable from the pull request's record afterwards. Recording it here --
// from the only place that still knows it -- is what lets the review gate establish continuity
// across a regeneration instead of refusing every release pull request (#342, #350).
//
// Opening the record before the rewrite rather than writing it afterwards is what makes an
// interrupted run recoverable: a cancellation between the force-push and the write would otherwise
// lose the discarded SHA permanently, and no later run could reconstruct it.
export async function openBranchRewriteRecords({ env, owner, repo, targetBranch }) {
  const heads = await readReleaseBranchHeads({ env, owner, repo, targetBranch });
  for (const [branch, head] of heads) {
    const pullRequestNumber = await findOpenPullRequestNumber({ env, owner, repo, branch });
    if (pullRequestNumber === null) continue;
    const records = await readBranchRewriteRecords({ env, owner, repo, pullRequestNumber });
    // A record left open by an interrupted run names a discarded head and no replacement. The
    // branch head standing here now is exactly what that rewrite created, because this workflow is
    // the only thing that rewrites the branch and it has not run since.
    for (const record of records) {
      if (record.marker.branch !== branch || record.marker.after !== null) continue;
      await completeBranchRewriteRecord({ env, owner, repo, record, after: head });
    }
    await githubRequest(env, `/repos/${owner}/${repo}/issues/${pullRequestNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: formatReleaseBranchRewriteMarker({ branch, before: head }),
      }),
    });
    console.log(`Opened release branch rewrite record on #${pullRequestNumber}: before=${head}`);
  }
  return heads;
}

// Failures here are logged rather than thrown. A release may already exist by this point, and
// failing the job would strand it without its assets. The cost of not throwing is bounded: the
// record stays open, the review gate keeps refusing exactly as it would have, and the next run
// completes it.
export async function closeBranchRewriteRecords({
  env,
  owner,
  repo,
  targetBranch,
  headsBeforeRegeneration,
}) {
  try {
    const headsAfter = await readReleaseBranchHeads({ env, owner, repo, targetBranch });
    for (const branch of headsBeforeRegeneration.keys()) {
      const after = headsAfter.get(branch);
      // An unchanged head discarded nothing. Completing the record with `after === before` says
      // exactly that, and the gate reads it as the non-event it was.
      if (!after) continue;
      const pullRequestNumber = await findOpenPullRequestNumber({ env, owner, repo, branch });
      if (pullRequestNumber === null) continue;
      const records = await readBranchRewriteRecords({ env, owner, repo, pullRequestNumber });
      const open = records.find(
        (record) => record.marker.branch === branch && record.marker.after === null,
      );
      if (!open) continue;
      await completeBranchRewriteRecord({ env, owner, repo, record: open, after });
      console.log(
        `Closed release branch rewrite record on #${pullRequestNumber}: ${open.marker.before} -> ${after}`,
      );
    }
  } catch (error) {
    console.error(
      `Could not close a release branch rewrite record: ${error.message}. The record stays open and the next run completes it.`,
    );
  }
}

async function completeBranchRewriteRecord({ env, owner, repo, record, after }) {
  await githubRequest(env, `/repos/${owner}/${repo}/issues/comments/${record.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      body: formatReleaseBranchRewriteMarker({
        branch: record.marker.branch,
        before: record.marker.before,
        after,
      }),
    }),
  });
}

async function readBranchRewriteRecords({ env, owner, repo, pullRequestNumber }) {
  const comments = await githubList(
    env,
    `/repos/${owner}/${repo}/issues/${pullRequestNumber}/comments`,
    "comment list for a release pull request",
  );
  const records = [];
  for (const comment of comments) {
    const marker = readReleaseBranchRewriteMarker(comment?.body);
    if (marker && Number.isInteger(comment?.id)) records.push({ id: comment.id, marker });
  }
  return records;
}

async function findOpenPullRequestNumber({ env, owner, repo, branch }) {
  const pulls = await githubList(
    env,
    `/repos/${owner}/${repo}/pulls?state=open&head=${owner}:${branch}`,
    "pull request list for a release branch",
  );
  const number = pulls.find((pull) => Number.isInteger(pull?.number))?.number;
  return number ?? null;
}

async function readReleaseBranchHeads({ env, owner, repo, targetBranch }) {
  const prefix = `heads/release-please--branches--${targetBranch}--`;
  // An indeterminate response is not an empty branch list. Reading it as one lets a rewrite proceed
  // with no record of what it discarded, which is the state this whole mechanism exists to prevent
  // and which nothing downstream could detect. An entry this function cannot read is the same
  // claim as a response it cannot read, so it is the same refusal: skipping the entry would make
  // its branch look absent, which is the reading being guarded against.
  const refs = await githubList(
    env,
    `/repos/${owner}/${repo}/git/matching-refs/${prefix}`,
    "release branch head list",
  );
  const heads = new Map();
  for (const ref of refs) {
    const branch = String(ref?.ref ?? "").replace(/^refs\/heads\//u, "");
    const sha = ref?.object?.sha;
    if (!branch || !/^[0-9a-f]{40}$/iu.test(sha ?? "")) {
      throw new Error("GitHub returned a malformed release branch head list.");
    }
    heads.set(branch, sha.toLowerCase());
  }
  return heads;
}

const GITHUB_PAGE_SIZE = 100;
const GITHUB_MAX_PAGES = 20;

/**
 * Every page of a GitHub list endpoint, or a throw.
 *
 * Three call sites read lists this script's correctness depends on, and each had its own
 * single-page request and its own array check. A first page is not a list: a release pull request
 * outlives a hundred comments, and the marker this mechanism has just written is the newest one, so
 * it is precisely what a first-page read drops. Running out of pages throws rather than returning
 * what was collected, because a short answer here is indistinguishable from "no such branch" and
 * that reading is what force-pushes a branch with no record of the head it discarded.
 */
async function githubList(env, path, description) {
  const items = [];
  for (let page = 1; page <= GITHUB_MAX_PAGES; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await githubRequest(
      env,
      `${path}${separator}per_page=${GITHUB_PAGE_SIZE}&page=${page}`,
    );
    if (!Array.isArray(batch)) {
      throw new Error(`GitHub returned a malformed ${description}.`);
    }
    items.push(...batch);
    if (batch.length < GITHUB_PAGE_SIZE) return items;
  }
  throw new Error(`GitHub returned more pages of ${description} than this script will read.`);
}

async function githubRequest(env, path, init = {}) {
  const token = env.RELEASE_PLEASE_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN;
  const apiUrl = env.GITHUB_API_URL || DEFAULT_GITHUB_API_URL;
  const response = await globalThis.fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    // Named rather than swallowed: a rewrite that was performed but not recorded is the case the
    // review gate cannot tell apart from one that never happened.
    throw new Error(`GitHub request failed: ${init.method ?? "GET"} ${path} -> ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

export function buildReleaseOutputs(releases) {
  const createdReleases = releases.filter(Boolean);
  const outputs = {
    release_created: "false",
    releases_created: String(createdReleases.length > 0),
    paths_released: JSON.stringify(createdReleases.map((release) => release.path || ".")),
  };

  for (const release of createdReleases) {
    const path = release.path || ".";
    if (path === ".") {
      outputs.release_created = "true";
    }

    for (const [rawKey, rawValue] of Object.entries(release)) {
      const key = normalizeOutputKey(rawKey);
      outputs[path === "." ? key : `${path}--${key}`] = stringifyOutputValue(rawValue);
    }
  }

  return outputs;
}

export function serializeGitHubOutput(outputs) {
  return (
    Object.entries(outputs)
      .map(([key, value]) => serializeGitHubOutputEntry(key, value))
      .join("\n") + "\n"
  );
}

export function resolveReleaseTargetBranch(env, repositoryDefaultBranch) {
  return env.RELEASE_PLEASE_TARGET_BRANCH || repositoryDefaultBranch;
}

function normalizeGraphqlUrl(url) {
  return url.replace(/\/graphql$/, "");
}

function normalizeOutputKey(key) {
  if (key === "tagName") return "tag_name";
  if (key === "uploadUrl") return "upload_url";
  if (key === "notes") return "body";
  if (key === "url") return "html_url";
  return key;
}

function stringifyOutputValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function serializeGitHubOutputEntry(key, value) {
  const text = String(value);
  if (!text.includes("\n")) {
    return `${key}=${text}`;
  }

  let delimiter = `release_please_${randomUUID()}`;
  while (text.includes(delimiter)) {
    delimiter = `release_please_${randomUUID()}`;
  }
  return `${key}<<${delimiter}\n${text}\n${delimiter}`;
}

const invokedScriptUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (import.meta.url === invokedScriptUrl) {
  runReleasePlease().catch((error) => {
    console.error(`release-please failed: ${error.message}`);
    process.exitCode = 1;
  });
}
