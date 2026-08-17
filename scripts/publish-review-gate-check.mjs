#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const CHECK_RUN_NAME = "Review gate";
const EXIT_VERDICTS = new Map([
  [0, { conclusion: "success", title: "Review gate passed" }],
  [1, { conclusion: "failure", title: "Review gate found blocking review state" }],
  [2, { conclusion: "action_required", title: "Review gate could not evaluate" }],
]);

const rawArgs = process.argv.slice(2);
const repo = readRequiredArg("--repo");
const headSha = readRequiredArg("--head-sha");
const detailsUrl = readRequiredArg("--details-url");
const exitCode = Number(readRequiredArg("--exit-code"));
const verdict = EXIT_VERDICTS.get(exitCode);

if (!repo.includes("/")) fail("--repo must be owner/name.");
if (!/^[0-9a-f]{40}$/iu.test(headSha)) fail("--head-sha must be a full commit SHA.");
if (!verdict) fail("--exit-code must be 0, 1, or 2.");

const summary =
  exitCode === 0
    ? "The review gate evaluated the pull request head and found no blocking state."
    : exitCode === 1
      ? "The review gate evaluated the pull request head and found a blocking state."
      : "The review gate could not evaluate the complete pull request review state.";

runText([
  "api",
  "-X",
  "POST",
  `repos/${repo}/check-runs`,
  "-H",
  "X-GitHub-Api-Version: 2022-11-28",
  "-f",
  `name=${CHECK_RUN_NAME}`,
  "-f",
  `head_sha=${headSha}`,
  "-f",
  "status=completed",
  "-f",
  `conclusion=${verdict.conclusion}`,
  "-f",
  `details_url=${detailsUrl}`,
  "-f",
  `output[title]=${verdict.title}`,
  "-f",
  `output[summary]=${summary}`,
]);

console.log(
  `${CHECK_RUN_NAME} check created for ${headSha} with conclusion ${verdict.conclusion}.`,
);

function readRequiredArg(name) {
  const index = rawArgs.indexOf(name);
  const value = index >= 0 ? rawArgs[index + 1] : null;
  if (!value || value.startsWith("--")) fail(`Pass ${name} <value>.`);
  return value;
}

function runText(commandArgs) {
  return execFileSync("gh", commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
