import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();
const workflowsDir = path.join(rootDir, ".github", "workflows");
const pinnedActionRefPattern = /@[\da-f]{40}$/i;
const requiredReviewGateBodyText = [
  "Pack Workflow Preflight",
  "Privacy And Data-Flow Impact",
  "Sensitive Surface Review",
  "Verification",
  "PR Review Follow-Up",
  "pnpm workflow:preflight",
];
const allowedActionPatterns = [
  /^actions\/checkout@[\da-f]{40}$/i,
  /^actions\/setup-node@[\da-f]{40}$/i,
  /^pnpm\/action-setup@[\da-f]{40}$/i,
  /^github\/codeql-action\/[^@\s]+@[\da-f]{40}$/i,
];

describe("Pack CI workflow", () => {
  it("uses allowed pinned actions, audits dependencies, and prints verified ZIP checksum evidence", async () => {
    const workflow = await readFile(path.join(rootDir, ".github", "workflows", "ci.yml"), "utf8");

    expect(workflow).not.toMatch(/uses:\s+[^@\s]+@[vV]\d+/);
    expect(workflow).toContain("pnpm exec playwright install --with-deps chromium");
    expect(workflow).toContain("pnpm audit --audit-level high");
    expect(workflow).toContain("node scripts/verify-extension-zip.mjs");
    expect(workflow).toContain("shasum -a 256 .output/*chrome.zip");
    expect(workflow).toContain("cat .output/complyeazepack-chrome.zip.sha256");
    expect(workflow).toContain(".output/complyeazepack-chrome.zip.sha256");
    expect(workflow).not.toContain("actions/upload-artifact");
  });

  it("runs a read-only current-head review findings gate", async () => {
    const workflow = await readFile(
      path.join(rootDir, ".github", "workflows", "review-gate.yml"),
      "utf8",
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("pull_request_review:");
    expect(workflow).toContain("pull_request_review_comment:");
    expect(workflow).not.toContain("pull_request_target:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).not.toContain("issue_comment:");
    expect(workflow).not.toContain("github.event.issue");
    expect(workflow).not.toContain("/review-gate");
    expect(workflow).toContain("name: Review findings gate");
    expect(workflow).toContain("name: Review gate");
    expect(workflow).toContain("pull-requests: read");
    expect(workflow).not.toContain("statuses: write");
    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(workflow).toContain("repository: ${{ steps.resolve-pr.outputs.head_repo }}");
    expect(workflow).toContain("ref: ${{ steps.resolve-pr.outputs.head_sha }}");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain("pnpm workflow:preflight");
    expect(workflow).toContain("pnpm review:gate");
    expect(workflow).toContain("ready_for_review, edited");
    expect(workflow).toContain("--strict-head-review");
    expect(workflow).toContain("--required-review-author chatgpt-codex-connector");
    expect(workflow).toContain("--wait-head-review-ms 180000");
    expect(workflow).toContain("--allow-missing-head-review");
    expect(workflow).toContain('--expected-head-oid "${{ steps.resolve-pr.outputs.head_sha }}"');
  });

  it("keeps every workflow action reference within the repository selected-actions policy", async () => {
    const workflowFiles = (await readdir(workflowsDir)).filter((file) => file.endsWith(".yml"));
    const disallowedReferences: string[] = [];

    for (const file of workflowFiles) {
      const workflow = await readFile(path.join(workflowsDir, file), "utf8");
      const actionReferences = [
        ...workflow.matchAll(/^\s*uses:\s+["']?([^"'\s#]+)["']?/gm),
      ].flatMap((match) => (match[1] ? [match[1]] : []));

      for (const reference of actionReferences) {
        if (reference.startsWith("./") || reference.startsWith("docker://")) {
          continue;
        }

        const isAllowed = allowedActionPatterns.some((pattern) => pattern.test(reference));
        if (!isAllowed || !pinnedActionRefPattern.test(reference)) {
          disallowedReferences.push(`${file}: ${reference}`);
        }
      }
    }

    expect(disallowedReferences).toEqual([]);
  });

  it("keeps generated Release Please PRs compatible with Pack gates", async () => {
    const prettierIgnore = await readFile(path.join(rootDir, ".prettierignore"), "utf8");
    const releaseConfig = JSON.parse(
      await readFile(path.join(rootDir, "release-please-config.json"), "utf8"),
    ) as {
      packages?: {
        "."?: {
          "pull-request-footer"?: string;
          "extra-files"?: Array<{ type?: string; path?: string }>;
        };
      };
    };
    const packConfig = releaseConfig.packages?.["."];

    expect(prettierIgnore).toContain("CHANGELOG.md");
    expect(packConfig?.["extra-files"]).toContainEqual({
      type: "generic",
      path: "src/extension/version.ts",
    });
    for (const required of requiredReviewGateBodyText) {
      expect(packConfig?.["pull-request-footer"]).toContain(required);
    }
  });

  it("requires an explicit repository variable before automatic Chrome Web Store submission", async () => {
    const releaseWorkflow = await readFile(
      path.join(rootDir, ".github", "workflows", "release.yml"),
      "utf8",
    );
    const releaseRunbook = await readFile(path.join(rootDir, "docs", "RELEASE.md"), "utf8");

    expect(releaseWorkflow).toContain("vars.CWS_SUBMIT_ENABLED == 'true'");
    expect(releaseWorkflow).toContain("environment: chrome-web-store");
    expect(releaseWorkflow).toContain("node scripts/publish-chrome-web-store.mjs");
    expect(releaseWorkflow).toContain("--zip .release/*chrome.zip");
    expect(releaseWorkflow).toContain("--provenance .release/pack-release-provenance.v1.json");
    expect(releaseRunbook).toContain("CWS_SUBMIT_ENABLED");
    expect(releaseRunbook).toContain("CWS_SUBMIT_ENABLED=true");
  });

  it("monitors Chrome Web Store review status without publishing side effects", async () => {
    const statusWorkflow = await readFile(
      path.join(rootDir, ".github", "workflows", "chrome-web-store-status.yml"),
      "utf8",
    );

    expect(statusWorkflow).toContain("schedule:");
    expect(statusWorkflow).toContain("workflow_dispatch:");
    expect(statusWorkflow).toContain("environment: chrome-web-store-status");
    expect(statusWorkflow).toContain("node scripts/check-chrome-web-store-status.mjs");
    expect(statusWorkflow).toContain("CWS_REQUIRE_PUBLISHED");
    expect(statusWorkflow).toContain("CWS_SERVICE_ACCOUNT_JSON");
    expect(statusWorkflow).not.toContain("CWS_REFRESH_TOKEN");
    expect(statusWorkflow).not.toContain("CWS_CLIENT_SECRET");
    expect(statusWorkflow).not.toContain("scripts/publish-chrome-web-store.mjs");
    expect(statusWorkflow).not.toContain(":publish");
    expect(statusWorkflow).not.toContain(":upload");
  });
});
