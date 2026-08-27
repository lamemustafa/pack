#!/usr/bin/env node

import { createHash } from "node:crypto";

if (process.argv.includes("--help")) {
  console.log(
    "Usage: node scripts/format-review-gate-disposition.mjs --finding-id <id> --disposition <fixed|stale|rejected|linked-follow-up> --evidence <text> (--source-body <body> | --source-fingerprint <sha256>) [--reasoning <text>] [--follow-up <issue>]",
  );
  process.exit(0);
}

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (!name?.startsWith("--") || value === undefined) fail("Arguments must be --name value pairs.");
  args.set(name, value);
}

const findingId = required("--finding-id");
const disposition = required("--disposition");
const evidence = required("--evidence");
const sourceFingerprint =
  args.get("--source-fingerprint") ?? fingerprint(required("--source-body"));
if (!/^[0-9a-f]{64}$/iu.test(sourceFingerprint))
  fail("--source-fingerprint must be a SHA-256 digest.");
if (!new Set(["fixed", "stale", "rejected", "linked-follow-up"]).has(disposition)) {
  fail("--disposition must be fixed, stale, rejected, or linked-follow-up.");
}
const reasoning = args.get("--reasoning");
const followUp = args.get("--follow-up");
if (disposition === "rejected" && !reasoning) fail("--reasoning is required for rejected.");
if (disposition === "linked-follow-up" && !followUp)
  fail("--follow-up is required for linked-follow-up.");

console.log(
  `<!-- review-gate-disposition:${JSON.stringify({
    findingId,
    disposition,
    sourceFingerprint,
    ...(followUp ? { followUp } : {}),
  })} -->\n\nFinding: ${findingId}\nDisposition: ${disposition}\nSource fingerprint: ${sourceFingerprint}\nEvidence: ${evidence}${reasoning ? `\nReasoning: ${reasoning}` : ""}${followUp ? `\nFollow-up: ${followUp}` : ""}`,
);

function required(name) {
  const value = args.get(name);
  if (!value) fail(`${name} is required.`);
  return value;
}

function fingerprint(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function fail(message) {
  console.error(`review-gate disposition format error: ${message}`);
  process.exit(2);
}
