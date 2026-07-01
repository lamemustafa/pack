/* global fetch */
import { createSign } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { URLSearchParams } from "node:url";

const args = parseArgs(process.argv.slice(2));
const zipPath = args.zip ? path.resolve(args.zip) : await findSingleChromeZip(process.cwd());
const extensionId =
  args.extensionId ?? process.env.CWS_EXTENSION_ID ?? "nfnbhekccajjfgkppolomflaeledoccb";
const publisherId = args.publisherId ?? process.env.CWS_PUBLISHER_ID;
const dryRun = args.dryRun === "true" || process.env.CWS_DRY_RUN === "true";
const deployPercentage = args.deployPercentage ?? process.env.CWS_DEPLOY_PERCENTAGE;
const blockOnWarnings = args.blockOnWarnings !== "false";

if (!publisherId) throw new Error("Missing CWS_PUBLISHER_ID or --publisher-id.");

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const zipSha256 = await sha256File(zipPath);
const name = `publishers/${publisherId}/items/${extensionId}`;

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        extensionId,
        publisherId,
        version: packageJson.version,
        zip: path.relative(process.cwd(), zipPath),
        zipSha256,
        blockOnWarnings,
        deployPercentage: deployPercentage ?? null,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const accessToken = await getAccessToken();
const uploadResult = await postMedia(
  `https://chromewebstore.googleapis.com/upload/v2/${name}:upload`,
  await readFile(zipPath),
  accessToken,
);
console.log(
  `Uploaded Chrome Web Store package for ${extensionId} at version ${packageJson.version}.`,
);
if (uploadResult.uploadState) console.log(`Upload state: ${uploadResult.uploadState}`);

const publishBody = {
  blockOnWarnings,
  ...(deployPercentage ? { deployPercentage: Number(deployPercentage) } : {}),
};
const publishResult = await postJson(
  `https://chromewebstore.googleapis.com/v2/${name}:publish`,
  publishBody,
  accessToken,
);
console.log(
  JSON.stringify(
    {
      extensionId,
      version: packageJson.version,
      zipSha256,
      publishStatus: publishResult.status ?? publishResult.publishStatus ?? "submitted",
      warnings: publishResult.itemWarnings ?? publishResult.warnings ?? [],
    },
    null,
    2,
  ),
);

async function getAccessToken() {
  if (process.env.CWS_ACCESS_TOKEN) return process.env.CWS_ACCESS_TOKEN;
  if (process.env.CWS_SERVICE_ACCOUNT_JSON) {
    return serviceAccountAccessToken(JSON.parse(process.env.CWS_SERVICE_ACCOUNT_JSON));
  }
  if (process.env.CWS_CLIENT_ID && process.env.CWS_CLIENT_SECRET && process.env.CWS_REFRESH_TOKEN) {
    return refreshTokenAccessToken({
      clientId: process.env.CWS_CLIENT_ID,
      clientSecret: process.env.CWS_CLIENT_SECRET,
      refreshToken: process.env.CWS_REFRESH_TOKEN,
    });
  }
  throw new Error(
    "Missing Chrome Web Store credentials. Provide CWS_SERVICE_ACCOUNT_JSON or OAuth CWS_CLIENT_ID, CWS_CLIENT_SECRET, and CWS_REFRESH_TOKEN.",
  );
}

async function serviceAccountAccessToken(serviceAccount) {
  const tokenUri = serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token";
  const iat = Math.floor(Date.now() / 1000);
  const assertion = [
    base64UrlJson({ alg: "RS256", typ: "JWT" }),
    base64UrlJson({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/chromewebstore",
      aud: tokenUri,
      exp: iat + 3600,
      iat,
    }),
  ].join(".");
  const signer = createSign("RSA-SHA256");
  signer.update(assertion);
  const jwt = `${assertion}.${base64Url(signer.sign(serviceAccount.private_key))}`;
  const result = await postForm(tokenUri, {
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  return result.access_token;
}

async function refreshTokenAccessToken({ clientId, clientSecret, refreshToken }) {
  const result = await postForm("https://oauth2.googleapis.com/token", {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return result.access_token;
}

async function postMedia(url, body, accessToken) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/zip",
    },
    body,
  });
  return responseJsonOrThrow(response, "Chrome Web Store upload failed");
}

async function postJson(url, body, accessToken) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return responseJsonOrThrow(response, "Chrome Web Store publish failed");
}

async function postForm(url, fields) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  return responseJsonOrThrow(response, "OAuth token request failed");
}

async function responseJsonOrThrow(response, label) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data.error_description ?? data.error?.message ?? text;
    throw new Error(`${label}: ${response.status} ${message}`);
  }
  return data;
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
  const { createHash } = await import("node:crypto");
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
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
