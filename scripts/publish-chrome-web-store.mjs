/* global fetch */
import { createHash, createSign } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { URLSearchParams, pathToFileURL } from "node:url";

const DEFAULT_EXTENSION_ID = "nfnbhekccajjfgkppolomflaeledoccb";
const DEFAULT_UPLOAD_POLL_ATTEMPTS = 30;
const DEFAULT_UPLOAD_POLL_INTERVAL_MS = 10_000;
const CWS_WRITE_SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const CWS_READONLY_SCOPE = "https://www.googleapis.com/auth/chromewebstore.readonly";
const UPLOAD_IN_PROGRESS_STATES = new Set(["IN_PROGRESS", "UPLOAD_IN_PROGRESS"]);
const UPLOAD_SUCCESS_STATES = new Set([
  "SUCCEEDED",
  "SUCCESS",
  "UPLOAD_COMPLETE",
  "UPLOAD_SUCCEEDED",
]);
const UPLOAD_FAILURE_STATES = new Set(["FAILED", "NOT_FOUND", "UPLOAD_FAILED"]);

export async function fetchChromeWebStoreStatus({
  extensionId = DEFAULT_EXTENSION_ID,
  publisherId,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const selectedPublisherId = publisherId ?? env.CWS_PUBLISHER_ID;
  if (!selectedPublisherId) throw new Error("Missing CWS_PUBLISHER_ID or --publisher-id.");

  const accessToken = await getAccessToken(env, fetchImpl, { scope: CWS_READONLY_SCOPE });
  const name = `publishers/${selectedPublisherId}/items/${extensionId}`;
  return getJson(
    `https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`,
    accessToken,
    fetchImpl,
    "Chrome Web Store fetchStatus failed",
  );
}

export async function publishChromeWebStorePackage({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  fetchImpl = fetch,
  sleepImpl = sleep,
  write = console.log,
} = {}) {
  const args = parseArgs(argv);
  const zipPath = args.zip ? path.resolve(cwd, args.zip) : await findSingleChromeZip(cwd);
  const extensionId = args.extensionId ?? env.CWS_EXTENSION_ID ?? DEFAULT_EXTENSION_ID;
  const publisherId = args.publisherId ?? env.CWS_PUBLISHER_ID;
  const releasePackage = await readReleasePackage({ args, cwd, env, zipPath });
  const dryRun = parseOptionalBoolean(args.dryRun ?? env.CWS_DRY_RUN, "dryRun") ?? false;
  const blockOnWarnings =
    parseOptionalBoolean(args.blockOnWarnings ?? env.CWS_BLOCK_ON_WARNINGS, "blockOnWarnings") ??
    true;
  const deployPercentage = args.deployPercentage ?? env.CWS_DEPLOY_PERCENTAGE;
  const uploadPollAttempts = parsePositiveInteger(
    args.uploadPollAttempts ?? env.CWS_UPLOAD_POLL_ATTEMPTS ?? String(DEFAULT_UPLOAD_POLL_ATTEMPTS),
    "uploadPollAttempts",
  );
  const uploadPollIntervalMs = parseNonNegativeInteger(
    args.uploadPollIntervalMs ??
      env.CWS_UPLOAD_POLL_INTERVAL_MS ??
      String(DEFAULT_UPLOAD_POLL_INTERVAL_MS),
    "uploadPollIntervalMs",
  );

  if (!publisherId) throw new Error("Missing CWS_PUBLISHER_ID or --publisher-id.");

  const zipSha256 = await sha256File(zipPath);
  assertReleasePackageMatchesTarget(releasePackage, extensionId);
  assertReleasePackageMatchesZip(releasePackage, zipPath, zipSha256);
  const name = `publishers/${publisherId}/items/${extensionId}`;
  const publishBody = buildPublishRequest({ blockOnWarnings, deployPercentage });

  if (dryRun) {
    const plan = {
      dryRun: true,
      extensionId,
      publisherId,
      version: releasePackage.version,
      sourceTag: releasePackage.sourceTag,
      zip: path.relative(cwd, zipPath),
      zipSha256,
      publishRequest: publishBody,
    };
    writeJson(write, plan);
    return plan;
  }

  const accessToken = await getAccessToken(env, fetchImpl);
  const uploadResult = await postMedia(
    `https://chromewebstore.googleapis.com/upload/v2/${name}:upload`,
    await readFile(zipPath),
    accessToken,
    fetchImpl,
  );
  write(
    `Uploaded Chrome Web Store package for ${extensionId} at version ${releasePackage.version}.`,
  );
  if (uploadResult.uploadState) write(`Upload state: ${uploadResult.uploadState}`);

  const uploadStatus = await waitForUploadCompletion({
    accessToken,
    fetchImpl,
    intervalMs: uploadPollIntervalMs,
    maxAttempts: uploadPollAttempts,
    name,
    sleepImpl,
    uploadResult,
    write,
  });
  assertUploadedVersion(uploadStatus, releasePackage.version);
  const publishResult = await postJson(
    `https://chromewebstore.googleapis.com/v2/${name}:publish`,
    publishBody,
    accessToken,
    fetchImpl,
  );
  const result = {
    extensionId,
    version: releasePackage.version,
    zipSha256,
    uploadState: uploadStatus.uploadState,
    publishState:
      publishResult.state ?? publishResult.status ?? publishResult.publishStatus ?? null,
    warnings:
      publishResult.warningInfo?.warnings ??
      publishResult.itemWarnings ??
      publishResult.warnings ??
      [],
  };
  writeJson(write, result);
  return result;
}

async function readReleasePackage({ args, cwd, env, zipPath }) {
  const provenanceFile = args.provenance ?? env.CWS_RELEASE_PROVENANCE;

  if (!provenanceFile) {
    const packageJson = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
    return {
      sourceTag: `v${packageJson.version}`,
      version: packageJson.version,
      zipAssetName: path.basename(zipPath),
      zipSha256: null,
    };
  }

  const provenancePath = path.resolve(cwd, provenanceFile);
  const provenance = parseRequiredJsonResponse(
    await readFile(provenancePath, "utf8"),
    `Release provenance ${path.relative(cwd, provenancePath)}`,
  );
  const version = provenance.product?.version;
  const sourceTag = provenance.source?.tag;
  const extensionId = provenance.chromeWebStore?.extensionId;
  const zipAssetName = provenance.package?.zipAssetName;
  const zipSha256 = provenance.package?.zipSha256;

  if (!version) {
    throw new Error(
      `Release provenance ${path.relative(cwd, provenancePath)} is missing product.version.`,
    );
  }
  if (!sourceTag) {
    throw new Error(
      `Release provenance ${path.relative(cwd, provenancePath)} is missing source.tag.`,
    );
  }
  if (sourceTag !== `v${version}`) {
    throw new Error(
      `Release provenance source tag ${sourceTag} does not match product.version ${version}.`,
    );
  }
  if (!extensionId) {
    throw new Error(
      `Release provenance ${path.relative(
        cwd,
        provenancePath,
      )} is missing chromeWebStore.extensionId.`,
    );
  }
  if (!zipAssetName) {
    throw new Error(
      `Release provenance ${path.relative(cwd, provenancePath)} is missing package.zipAssetName.`,
    );
  }
  if (!zipAssetName.includes(`-${version}-`)) {
    throw new Error(
      `Release provenance ZIP asset ${zipAssetName} does not include product.version ${version}.`,
    );
  }
  if (!zipSha256) {
    throw new Error(
      `Release provenance ${path.relative(cwd, provenancePath)} is missing package.zipSha256.`,
    );
  }

  return {
    extensionId,
    sourceTag,
    version,
    zipAssetName,
    zipSha256,
  };
}

function assertReleasePackageMatchesTarget(releasePackage, extensionId) {
  if (releasePackage.extensionId && extensionId !== releasePackage.extensionId) {
    throw new Error(
      `Release provenance Chrome Web Store extension ID ${releasePackage.extensionId} does not match selected extension ID ${extensionId}.`,
    );
  }
}

function assertReleasePackageMatchesZip(releasePackage, zipPath, zipSha256) {
  if (releasePackage.zipAssetName && path.basename(zipPath) !== releasePackage.zipAssetName) {
    throw new Error(
      `Release provenance ZIP asset ${releasePackage.zipAssetName} does not match selected ZIP ${path.basename(
        zipPath,
      )}.`,
    );
  }

  if (releasePackage.zipSha256 && zipSha256 !== releasePackage.zipSha256) {
    throw new Error(
      `Release provenance ZIP SHA-256 ${releasePackage.zipSha256} does not match selected ZIP ${zipSha256}.`,
    );
  }
}

export function buildPublishRequest({ blockOnWarnings = true, deployPercentage } = {}) {
  const body = { blockOnWarnings };
  const parsedDeployPercentage = parseOptionalDeployPercentage(deployPercentage);

  if (parsedDeployPercentage !== null) {
    body.deployInfos = [{ deployPercentage: parsedDeployPercentage }];
  }

  return body;
}

export async function waitForUploadCompletion({
  accessToken,
  fetchImpl,
  intervalMs,
  maxAttempts,
  name,
  sleepImpl,
  uploadResult,
  write,
}) {
  const initialState = normalizeUploadState(uploadResult.uploadState);
  if (isSuccessfulUpload(initialState, uploadResult)) {
    return {
      crxVersion: uploadResult.crxVersion,
      uploadState: uploadResult.uploadState ?? "SUCCEEDED",
    };
  }

  if (isFailedUpload(initialState)) {
    throw new Error(`Chrome Web Store upload failed with state ${uploadResult.uploadState}.`);
  }

  if (!isInProgressUpload(initialState)) {
    throw new Error(
      `Chrome Web Store upload response did not include a completed upload state or crxVersion: ${JSON.stringify(uploadResult)}`,
    );
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (intervalMs > 0) await sleepImpl(intervalMs);

    const status = await getJson(
      `https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`,
      accessToken,
      fetchImpl,
      "Chrome Web Store fetchStatus failed",
    );
    const state = normalizeUploadState(status.lastAsyncUploadState);
    write(
      `Async upload state (${attempt}/${maxAttempts}): ${status.lastAsyncUploadState ?? "unknown"}`,
    );

    if (isSuccessfulUpload(state, status)) {
      return { uploadState: status.lastAsyncUploadState, fetchStatus: status };
    }

    if (isFailedUpload(state)) {
      throw new Error(
        `Chrome Web Store async upload failed with state ${status.lastAsyncUploadState}.`,
      );
    }

    if (!isInProgressUpload(state)) {
      throw new Error(
        `Chrome Web Store fetchStatus returned an unexpected upload state: ${status.lastAsyncUploadState ?? "missing"}.`,
      );
    }
  }

  throw new Error(
    `Chrome Web Store upload stayed in progress after ${maxAttempts} fetchStatus polls.`,
  );
}

async function getAccessToken(env, fetchImpl, { scope = CWS_WRITE_SCOPE } = {}) {
  if (env.CWS_ACCESS_TOKEN) return env.CWS_ACCESS_TOKEN;
  if (env.CWS_SERVICE_ACCOUNT_JSON) {
    return serviceAccountAccessToken(JSON.parse(env.CWS_SERVICE_ACCOUNT_JSON), fetchImpl, scope);
  }
  if (env.CWS_CLIENT_ID && env.CWS_CLIENT_SECRET && env.CWS_REFRESH_TOKEN) {
    return refreshTokenAccessToken({
      clientId: env.CWS_CLIENT_ID,
      clientSecret: env.CWS_CLIENT_SECRET,
      fetchImpl,
      refreshToken: env.CWS_REFRESH_TOKEN,
    });
  }
  throw new Error(
    "Missing Chrome Web Store credentials. Provide CWS_SERVICE_ACCOUNT_JSON or OAuth CWS_CLIENT_ID, CWS_CLIENT_SECRET, and CWS_REFRESH_TOKEN.",
  );
}

async function serviceAccountAccessToken(serviceAccount, fetchImpl, scope) {
  const tokenUri = serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token";
  const iat = Math.floor(Date.now() / 1000);
  const assertion = [
    base64UrlJson({ alg: "RS256", typ: "JWT" }),
    base64UrlJson({
      iss: serviceAccount.client_email,
      scope,
      aud: tokenUri,
      exp: iat + 3600,
      iat,
    }),
  ].join(".");
  const signer = createSign("RSA-SHA256");
  signer.update(assertion);
  const jwt = `${assertion}.${base64Url(signer.sign(serviceAccount.private_key))}`;
  const result = await postForm(
    tokenUri,
    {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    },
    fetchImpl,
  );
  return result.access_token;
}

async function refreshTokenAccessToken({ clientId, clientSecret, fetchImpl, refreshToken }) {
  const result = await postForm(
    "https://oauth2.googleapis.com/token",
    {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    },
    fetchImpl,
  );
  return result.access_token;
}

async function postMedia(url, body, accessToken, fetchImpl) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/zip",
    },
    body,
  });
  return responseJsonOrThrow(response, "Chrome Web Store upload failed");
}

async function postJson(url, body, accessToken, fetchImpl) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return responseJsonOrThrow(response, "Chrome Web Store publish failed");
}

async function getJson(url, accessToken, fetchImpl, label) {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return responseJsonOrThrow(response, label);
}

async function postForm(url, fields, fetchImpl) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  return responseJsonOrThrow(response, "OAuth token request failed");
}

async function responseJsonOrThrow(response, label) {
  const text = await response.text();
  if (!response.ok) {
    const data = parseOptionalJsonResponse(text);
    const message = formatApiError(data, text);
    throw new Error(`${label}: ${response.status} ${message}`);
  }
  return parseRequiredJsonResponse(text, label);
}

function formatApiError(data, text) {
  if (typeof data.error === "string" && data.error_description) {
    return `${data.error}: ${data.error_description}`;
  }
  if (typeof data.error === "string") return data.error;
  if (data.error?.message) return data.error.message;
  return text;
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

function parseOptionalDeployPercentage(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`Expected deployPercentage to be an integer from 0 to 100, got ${value}.`);
  }
  return parsed;
}

function parsePositiveInteger(value, name) {
  const parsed = parseNonNegativeInteger(value, name);
  if (parsed < 1) throw new Error(`Expected ${name} to be greater than 0, got ${value}.`);
  return parsed;
}

function parseNonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected ${name} to be a nonnegative integer, got ${value}.`);
  }
  return parsed;
}

async function findSingleChromeZip(dir) {
  const entries = await readdir(dir);
  const zipFiles = entries
    .filter((entry) => entry.endsWith(".zip") && entry.includes("chrome"))
    .map((entry) => path.join(dir, entry));
  if (zipFiles.length !== 1) {
    throw new Error(`Expected exactly one Chrome ZIP in ${dir}, found ${zipFiles.length}.`);
  }
  return zipFiles[0];
}

async function sha256File(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function normalizeUploadState(state) {
  return typeof state === "string" ? state.toUpperCase() : null;
}

function isInProgressUpload(state) {
  return UPLOAD_IN_PROGRESS_STATES.has(state);
}

function isSuccessfulUpload(state, result) {
  return UPLOAD_SUCCESS_STATES.has(state) || (!state && Boolean(result.crxVersion));
}

function isFailedUpload(state) {
  return UPLOAD_FAILURE_STATES.has(state);
}

function assertUploadedVersion(uploadStatus, expectedVersion) {
  const versions = new Set(
    [
      uploadStatus.crxVersion,
      uploadStatus.fetchStatus?.submittedItemRevisionStatus?.distributionChannels?.[0]?.crxVersion,
    ].filter(Boolean),
  );

  if (versions.size === 0) {
    throw new Error(
      `Chrome Web Store upload did not return CRX version evidence for package.json version ${expectedVersion}.`,
    );
  }

  for (const crxVersion of versions) {
    if (crxVersion !== expectedVersion) {
      throw new Error(
        `Chrome Web Store upload version ${crxVersion} does not match package.json version ${expectedVersion}.`,
      );
    }
  }
}

function parseOptionalJsonResponse(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function parseRequiredJsonResponse(text, label) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: response was not valid JSON`);
  }
}

function writeJson(write, value) {
  write(JSON.stringify(value, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function base64UrlJson(value) {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishChromeWebStorePackage().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
