import { appendFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const { GitHub, Manifest, VERSION } = require("release-please");

const DEFAULT_CONFIG_FILE = "release-please-config.json";
const DEFAULT_MANIFEST_FILE = ".release-please-manifest.json";
const DEFAULT_GITHUB_API_URL = "https://api.github.com";
const DEFAULT_GITHUB_GRAPHQL_URL = "https://api.github.com";

export async function runReleasePlease(env = process.env) {
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
    defaultBranch: env.RELEASE_PLEASE_TARGET_BRANCH || env.GITHUB_REF_NAME,
  });
  const targetBranch =
    env.RELEASE_PLEASE_TARGET_BRANCH || env.GITHUB_REF_NAME || github.repository.defaultBranch;
  const configFile = env.RELEASE_PLEASE_CONFIG_FILE || DEFAULT_CONFIG_FILE;
  const manifestFile = env.RELEASE_PLEASE_MANIFEST_FILE || DEFAULT_MANIFEST_FILE;

  const releaseManifest = await Manifest.fromManifest(
    github,
    targetBranch,
    configFile,
    manifestFile,
  );
  const releases = (await releaseManifest.createReleases()).filter(Boolean);
  const outputs = buildReleaseOutputs(releases);

  const pullRequestManifest = await Manifest.fromManifest(
    github,
    targetBranch,
    configFile,
    manifestFile,
  );
  const pullRequests = (await pullRequestManifest.createPullRequests()).filter(Boolean);
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
