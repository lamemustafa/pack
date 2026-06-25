import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

describe("Pack CI workflow", () => {
  it("uses allowed pinned actions, audits dependencies, and prints verified ZIP checksum evidence", async () => {
    const workflow = await readFile(path.join(rootDir, ".github", "workflows", "ci.yml"), "utf8");

    expect(workflow).not.toMatch(/uses:\s+[^@\s]+@[vV]\d+/);
    expect(workflow).toContain("pnpm audit --audit-level high");
    expect(workflow).toContain("shasum -a 256 .output/*chrome.zip");
    expect(workflow).toContain("cat .output/complyeazepack-chrome.zip.sha256");
    expect(workflow).toContain(".output/complyeazepack-chrome.zip.sha256");
    expect(workflow).not.toContain("actions/upload-artifact");
  });

  it("runs a current-head review findings gate on PR, review, and branch-dispatched manual recovery events", async () => {
    const workflow = await readFile(
      path.join(rootDir, ".github", "workflows", "review-gate.yml"),
      "utf8",
    );

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("pull_request_review:");
    expect(workflow).toContain("pull_request_review_comment:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("issue_comment:");
    expect(workflow).not.toContain("github.event.issue");
    expect(workflow).not.toContain("/review-gate");
    expect(workflow).toContain("name: Review findings gate");
    expect(workflow).toContain("name: Review findings gate");
    expect(workflow).toContain("pull-requests: read");
    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(workflow).toContain("--strict-head-review");
    expect(workflow).toContain("--required-review-author chatgpt-codex-connector");
    expect(workflow).toContain("--wait-head-review-ms 180000");
    expect(workflow).toContain("--allow-missing-head-review");
  });
});
