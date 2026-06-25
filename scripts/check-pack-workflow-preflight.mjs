#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const protectedBranches = new Set(["main", "master"]);
let repoRoot = process.cwd();
repoRoot = gitText(["rev-parse", "--show-toplevel"]);
const branch = readArg("--branch") ?? currentBranch();
const baseRef = readArg("--base-ref") ?? process.env.GITHUB_BASE_REF ?? "master";
const issues = [];
const warnings = [];

checkBranch();
checkWorktreeClean();
checkGuidanceFreshness();
checkPrTemplate();

for (const warning of warnings) console.warn(`warn: ${warning}`);
for (const issue of issues) console.error(`error: ${issue}`);

if (issues.length > 0) process.exit(1);

console.log(`Pack workflow preflight passed for ${branch || "detached"} against ${baseRef}.`);

function checkBranch() {
  if (!branch || branch === "HEAD") {
    issues.push("current checkout is detached; create a Pack branch before non-trivial edits");
    return;
  }

  if (protectedBranches.has(branch)) {
    issues.push(`current branch is ${branch}; create a Pack branch before non-trivial edits`);
  }

  if (!branch.startsWith("tapish-codex/") && !protectedBranches.has(branch)) {
    warnings.push(`branch ${branch} does not use tapish-codex/<short-scope>; acceptable for forks only`);
  }
}

function checkWorktreeClean() {
  const status = gitText(["status", "--porcelain"]);
  if (status) {
    issues.push(
      "working tree has uncommitted files; inspect them before editing/staging and keep unrelated files out of this Pack lane",
    );
  }
}

function checkGuidanceFreshness() {
  const remoteBase = `origin/${baseRef}`;
  if (!gitRefExists(remoteBase)) {
    warnings.push(`could not find ${remoteBase}; run git fetch origin before relying on Pack guidance freshness checks`);
    return;
  }

  try {
    execFileSync(
      "git",
      ["diff", "--quiet", `HEAD...${remoteBase}`, "--", "AGENTS.md", "docs/AGENT_REVIEW_RECTIFY.md"],
      { cwd: repoRoot, stdio: "ignore" },
    );
  } catch {
    warnings.push(
      `${remoteBase} has AGENTS/review guidance changes not present in HEAD; rebase/merge latest ${baseRef} before sensitive Pack work`,
    );
  }
}

function checkPrTemplate() {
  const templatePath = join(repoRoot, ".github", "PULL_REQUEST_TEMPLATE.md");
  if (!existsSync(templatePath)) {
    issues.push("missing .github/PULL_REQUEST_TEMPLATE.md workflow checklist");
    return;
  }

  const template = readFileSync(templatePath, "utf8");
  for (const required of [
    "Pack Workflow Preflight",
    "opened from a Pack branch, not master",
    "latest master Pack AGENTS guidance",
    "required Pack privacy/review/verification checklist visible",
  ]) {
    if (!template.includes(required)) {
      issues.push(`PR template is missing required Pack workflow checklist text: ${required}`);
    }
  }
}

function currentBranch() {
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF;
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  return gitText(["branch", "--show-current"]);
}

function gitRefExists(ref) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function readArg(name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

function gitText(commandArgs) {
  return execFileSync("git", commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
