import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();
const scriptPath = path.join(rootDir, "scripts", "check-pack-workflow-preflight.mjs");

describe("Pack workflow preflight", () => {
  it("passes on a clean Pack task branch with the workflow checklist present", () => {
    const repo = createPackRepo("tapish-codex/preflight-test");

    const output = execFileSync(process.execPath, [scriptPath], {
      cwd: repo,
      encoding: "utf8",
    });

    expect(output).toContain("Pack workflow preflight passed");
  });

  it("fails on master", () => {
    const repo = createPackRepo("master");

    expect(() =>
      execFileSync(process.execPath, [scriptPath], {
        cwd: repo,
        encoding: "utf8",
      }),
    ).toThrow(/create a Pack branch/);
  });

  it("fails when the PR template is missing required workflow checklist text", () => {
    const repo = createPackRepo("tapish-codex/missing-template");
    writeFileSync(path.join(repo, ".github", "PULL_REQUEST_TEMPLATE.md"), "## Summary\n", "utf8");
    git(repo, ["add", ".github/PULL_REQUEST_TEMPLATE.md"]);
    git(repo, ["commit", "-m", "break template"]);

    expect(() =>
      execFileSync(process.execPath, [scriptPath], {
        cwd: repo,
        encoding: "utf8",
      }),
    ).toThrow(/PR template is missing required Pack workflow checklist text/);
  });
});

function createPackRepo(branch: string) {
  const repo = mkdtempSync(path.join(tmpdir(), "pack-workflow-preflight-"));
  mkdirSync(path.join(repo, ".github"), { recursive: true });
  mkdirSync(path.join(repo, "docs"), { recursive: true });
  writeFileSync(path.join(repo, "AGENTS.md"), "# Pack Agents\n", "utf8");
  writeFileSync(path.join(repo, "docs", "AGENT_REVIEW_RECTIFY.md"), "# Review\n", "utf8");
  writeFileSync(
    path.join(repo, ".github", "PULL_REQUEST_TEMPLATE.md"),
    [
      "## Pack Workflow Preflight",
      "- [ ] This PR was opened from a Pack branch, not master.",
      "- [ ] I checked latest master Pack AGENTS guidance or recorded the stale-guidance warning.",
      "- [ ] PR body keeps the required Pack privacy/review/verification checklist visible.",
      "## Sanchika Adoption Gate",
      "- [ ] I read `sanchika/docs/adoption-pack.md` in the coordinated parent worktree.",
      "- [ ] This PR links ComplyEaze and Axal completion evidence.",
    ].join("\n"),
    "utf8",
  );

  git(repo, ["init", "-b", "master"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test User"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);

  if (branch !== "master") {
    git(repo, ["checkout", "-b", branch]);
  }

  return repo;
}

function git(cwd: string, args: string[]) {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
  });
}
