/* global fetch */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { fetchChromeWebStoreStatus } from "./publish-chrome-web-store.mjs";

const DEFAULT_EXTENSION_ID = "nfnbhekccajjfgkppolomflaeledoccb";
const FAILURE_STATES = new Set([
  "CANCELLED",
  "FAILED",
  "FAILURE",
  "REJECTED",
  "REJECTED_FOR_POLICY",
]);
const PENDING_STATES = new Set([
  "IN_REVIEW",
  "PENDING",
  "PENDING_REVIEW",
  "PENDING_REVIEW_PUBLISH",
  "SUBMITTED",
]);
const PUBLISHED_STATES = new Set(["OK", "PUBLISHED", "PUBLIC", "LIVE"]);

export async function checkChromeWebStoreStatus({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  fetchImpl = fetch,
  write = console.log,
} = {}) {
  const args = parseArgs(argv);
  const extensionId = args.extensionId ?? env.CWS_EXTENSION_ID ?? DEFAULT_EXTENSION_ID;
  const expectedVersion =
    nonEmptyString(args.expectedVersion) ??
    nonEmptyString(env.CWS_EXPECTED_VERSION) ??
    (await readPackageVersion(cwd));
  const requirePublished =
    parseOptionalBoolean(args.requirePublished ?? env.CWS_REQUIRE_PUBLISHED, "requirePublished") ??
    false;

  const status = await fetchChromeWebStoreStatus({
    extensionId,
    publisherId: args.publisherId ?? env.CWS_PUBLISHER_ID,
    env,
    fetchImpl,
  });
  const summary = summarizeChromeWebStoreStatus(status, {
    extensionId,
    expectedVersion,
    publisherId: args.publisherId ?? env.CWS_PUBLISHER_ID ?? null,
  });

  assertChromeWebStoreStatus(summary, { requirePublished });
  write(JSON.stringify(summary, null, 2));
  return summary;
}

export function summarizeChromeWebStoreStatus(
  status,
  { extensionId = DEFAULT_EXTENSION_ID, expectedVersion, publisherId = null } = {},
) {
  const submittedVersion = firstString([
    ...distributionVersions(status.submittedItemRevisionStatus),
    ...distributionVersions(status.itemRevisionStatus),
  ]);
  const publishedVersion = firstString([
    ...distributionVersions(status.publishedItemRevisionStatus),
    ...distributionVersions(status.publicItemRevisionStatus),
  ]);
  const anyVersion = firstString([...collectValuesByKey(status, "crxVersion")]);
  const states = uniqueStrings([
    status.lastAsyncUploadState,
    status.itemState,
    status.state,
    status.reviewState,
    status.publishState,
    status.submittedItemRevisionStatus?.itemState,
    status.submittedItemRevisionStatus?.state,
    status.submittedItemRevisionStatus?.reviewState,
    status.publishedItemRevisionStatus?.itemState,
    status.publishedItemRevisionStatus?.state,
    status.publishedItemRevisionStatus?.reviewState,
  ]);
  const normalizedStates = states.map((state) => state.toUpperCase());
  const hasFailureState =
    normalizedStates.some((state) => FAILURE_STATES.has(state)) || status.takenDown === true;
  const hasPendingState = normalizedStates.some((state) => PENDING_STATES.has(state));
  const hasPublishedState = normalizedStates.some((state) => PUBLISHED_STATES.has(state));
  const expectedSubmitted = expectedVersion ? submittedVersion === expectedVersion : null;
  const expectedPublished = expectedVersion ? publishedVersion === expectedVersion : null;

  return {
    extensionId,
    publisherId,
    expectedVersion: expectedVersion ?? null,
    submittedVersion: submittedVersion ?? null,
    publishedVersion: publishedVersion ?? null,
    latestObservedVersion: submittedVersion ?? publishedVersion ?? anyVersion ?? null,
    states,
    takenDown: status.takenDown === true,
    expectedSubmitted,
    expectedPublished,
    pendingReview: hasPendingState && !hasFailureState && !expectedPublished,
    published:
      !hasFailureState && Boolean(expectedPublished || (!expectedVersion && hasPublishedState)),
    failed: hasFailureState,
  };
}

function assertChromeWebStoreStatus(summary, { requirePublished }) {
  if (summary.failed) {
    if (summary.takenDown) {
      throw new Error(
        `Chrome Web Store item ${summary.extensionId} has been taken down for a policy violation.`,
      );
    }

    throw new Error(
      `Chrome Web Store item ${summary.extensionId} has a failed/rejected state: ${summary.states.join(", ")}`,
    );
  }

  if (summary.expectedVersion && !summary.expectedSubmitted && !summary.expectedPublished) {
    throw new Error(
      `Chrome Web Store status does not show expected version ${summary.expectedVersion}. Latest observed version: ${summary.latestObservedVersion ?? "unknown"}.`,
    );
  }

  if (requirePublished && !summary.published) {
    throw new Error(
      `Chrome Web Store version ${summary.expectedVersion ?? "unknown"} is not published yet.`,
    );
  }
}

async function readPackageVersion(cwd) {
  const packageJson = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
  if (!packageJson.version) throw new Error("package.json is missing version.");
  return packageJson.version;
}

function distributionVersions(revisionStatus) {
  if (!revisionStatus) return [];
  return [
    revisionStatus.crxVersion,
    ...(revisionStatus.distributionChannels ?? []).map((channel) => channel?.crxVersion),
  ].filter(Boolean);
}

function collectValuesByKey(value, key, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const values = [];

  if (Object.prototype.hasOwnProperty.call(value, key)) {
    values.push(value[key]);
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) values.push(...collectValuesByKey(item, key, seen));
    } else if (child && typeof child === "object") {
      values.push(...collectValuesByKey(child, key, seen));
    }
  }

  return values;
}

function firstString(values) {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? null;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value)));
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key?.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    parsed[toCamelCase(key.slice(2))] = value;
    index += 1;
  }
  return parsed;
}

function parseOptionalBoolean(value, name) {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`Expected ${name} to be true or false, got ${value}.`);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkChromeWebStoreStatus().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
