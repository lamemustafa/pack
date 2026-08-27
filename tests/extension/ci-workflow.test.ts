import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/uses:\s+[^@\s]+@[vV]\d+/);
    expect(workflow).toContain("pnpm exec playwright install --with-deps chromium");
    expect(workflow).toContain("pnpm audit --audit-level high");
    expect(workflow).toContain("node scripts/verify-extension-zip.mjs");
    expect(workflow).toContain("shasum -a 256 .output/*chrome.zip");
    expect(workflow).toContain("cat .output/complyeazepack-chrome.zip.sha256");
    expect(workflow).toContain(".output/complyeazepack-chrome.zip.sha256");
    expect(workflow).not.toContain("actions/upload-artifact");
  });

  it("isolates PR-head execution from trusted scheduled reconciliation", async () => {
    const prWorkflow = await readFile(
      path.join(rootDir, ".github", "workflows", "review-gate.yml"),
      "utf8",
    );
    const trustedWorkflow = await readFile(
      path.join(rootDir, ".github", "workflows", "review-gate-reconcile.yml"),
      "utf8",
    );

    expect(prWorkflow).not.toContain("workflow_dispatch:");
    expect(prWorkflow).not.toContain("schedule:");
    expect(prWorkflow).toContain(
      "pull_request:\n    types: [opened, reopened, synchronize, ready_for_review, edited]",
    );
    expect(prWorkflow).toContain("pull_request_review:\n    types: [submitted, edited, dismissed]");
    expect(prWorkflow).toContain(
      "pull_request_review_comment:\n    types: [created, edited, deleted]",
    );
    expect(prWorkflow).not.toContain("pull_request_target:");
    expect(prWorkflow).not.toContain("issue_comment:");
    expect(prWorkflow).not.toContain("github.event.issue");
    expect(prWorkflow).not.toContain("/review-gate");
    expect(prWorkflow).toContain("name: Review gate");
    expect(prWorkflow).not.toContain("checks: write");
    expect(prWorkflow).not.toContain("statuses: write");
    expect(prWorkflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(prWorkflow).toContain("repository: ${{ steps.resolve-pr.outputs.head_repo }}");
    expect(prWorkflow).toContain("ref: ${{ steps.resolve-pr.outputs.head_sha }}");
    expect(prWorkflow).toContain("pnpm install --frozen-lockfile");
    expect(prWorkflow).toContain("pnpm workflow:preflight");
    expect(prWorkflow).toContain("pnpm review:gate");
    expect(prWorkflow).toContain("ready_for_review, edited");
    expect(prWorkflow).toContain("--strict-head-review");
    expect(prWorkflow).toContain("--required-review-author chatgpt-codex-connector");
    expect(prWorkflow).toContain("--wait-head-review-ms 180000");
    expect(prWorkflow).toContain("--allow-missing-head-review");
    expect(prWorkflow).toContain('--expected-head-oid "${{ steps.resolve-pr.outputs.head_sha }}"');

    expect(trustedWorkflow).toContain("workflow_dispatch:");
    expect(trustedWorkflow).toContain('schedule:\n    - cron: "*/15 * * * *"');
    expect(trustedWorkflow).toContain(
      "concurrency:\n  group: review-gate-reconcile\n  cancel-in-progress: false",
    );
    expect(trustedWorkflow).not.toContain("pull_request:");
    expect(trustedWorkflow).not.toContain("pull_request_review:");
    expect(trustedWorkflow).not.toContain("pull_request_review_comment:");
    expect(trustedWorkflow).not.toContain("github.event.inputs.pr");
    expect(trustedWorkflow).not.toContain("EVENT_NAME: ${{ github.event_name }}");
    expect(trustedWorkflow.match(/checks: write/g)).toHaveLength(1);
    expect(trustedWorkflow).toMatch(
      /scheduled-review-gate:[\s\S]*?permissions:\n\s+contents: read\n\s+issues: read\n\s+pull-requests: read\n\s+checks: write/,
    );
    expect(trustedWorkflow).not.toContain("statuses: write");
    expect(trustedWorkflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(trustedWorkflow).not.toContain("steps.resolve-pr.outputs");
    expect(trustedWorkflow).not.toContain("cache:");
    expect(trustedWorkflow).not.toContain("pnpm install");
    expect(trustedWorkflow).not.toContain("pnpm workflow:preflight");
    expect(trustedWorkflow).toContain("scripts/publish-review-gate-check.mjs");
    expect(trustedWorkflow).toContain("--reconcile-open-prs");
    expect(trustedWorkflow).toContain("--max-prs 4");
    expect(trustedWorkflow).toMatch(
      /scheduled-review-gate:[\s\S]*?ref: \$\{\{ github\.event\.repository\.default_branch \}\}/,
    );
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
    for (const path of ["src/extension/version.ts", "README.md", "docs/PUBLICATION_READINESS.md"]) {
      expect(packConfig?.["extra-files"]).toContainEqual({ type: "generic", path });
    }
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
    const publisher = await readFile(
      path.join(rootDir, "scripts", "publish-chrome-web-store.mjs"),
      "utf8",
    );
    const missingCredentialContract = publisher.match(
      /"(Missing Chrome Web Store credentials\.[^"]+)"/,
    )?.[1];
    const contractCredentialNames = [
      ...new Set(missingCredentialContract?.match(/CWS_[A-Z_]+/g) ?? []),
    ];

    expect(statusWorkflow).toContain("schedule:");
    expect(statusWorkflow).toContain("workflow_dispatch:");
    expect(statusWorkflow).toContain("environment: chrome-web-store-status");
    expect(statusWorkflow).toContain(
      'if [[ "$GITHUB_EVENT_NAME" == "schedule" && "$CWS_REQUIRE_PUBLISHED" == "false" ]]',
    );
    expect(statusWorkflow).toContain(
      '[[ "$status_output" == "Missing Chrome Web Store credentials."* ]]',
    );
    expect(statusWorkflow).toContain('exit "$status_code"');
    expect(statusWorkflow).toContain("Chrome Web Store status check skipped");
    expect(statusWorkflow).toContain("the non-strict scheduled status check did not run");
    expect(statusWorkflow).toContain("node scripts/check-chrome-web-store-status.mjs");
    expect(statusWorkflow).toContain("CWS_REQUIRE_PUBLISHED");
    expect(contractCredentialNames.length).toBeGreaterThan(0);
    for (const name of contractCredentialNames) {
      expect(statusWorkflow).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    expect(statusWorkflow).not.toContain("scripts/publish-chrome-web-store.mjs");
    expect(statusWorkflow).not.toContain(":publish");
    expect(statusWorkflow).not.toContain(":upload");
  });

  it("skips only an unconfigured non-strict schedule and admits either credential form", async () => {
    const statusWorkflow = await readFile(
      path.join(rootDir, ".github", "workflows", "chrome-web-store-status.yml"),
      "utf8",
    );
    const publisher = await readFile(
      path.join(rootDir, "scripts", "publish-chrome-web-store.mjs"),
      "utf8",
    );
    const missingCredentials = publisher.match(
      /"(Missing Chrome Web Store credentials\.[^"]+)"/,
    )?.[1];
    expect(missingCredentials).toBeTruthy();

    const fixtureDir = await mkdtemp(path.join(tmpdir(), "pack-cws-status-workflow-"));
    try {
      const fakeNode = path.join(fixtureDir, "node");
      await writeFile(
        fakeNode,
        `#!/bin/sh
if [ "$FAKE_CREDENTIAL_FORM" = "service-account" ] && [ -z "$CWS_SERVICE_ACCOUNT_JSON" ]; then exit 9; fi
if [ "$FAKE_CREDENTIAL_FORM" = "oauth" ] && { [ -z "$CWS_CLIENT_ID" ] || [ -z "$CWS_CLIENT_SECRET" ] || [ -z "$CWS_REFRESH_TOKEN" ]; }; then exit 9; fi
printf '%s\\n' "$FAKE_NODE_OUTPUT"
exit "$FAKE_NODE_EXIT"
`,
      );
      await chmod(fakeNode, 0o755);

      const runScript = extractLastWorkflowRunScript(statusWorkflow);
      const scheduledSummary = path.join(fixtureDir, "scheduled-summary.md");
      const scheduled = runWorkflowShell(runScript, fixtureDir, {
        CWS_REQUIRE_PUBLISHED: "false",
        FAKE_NODE_EXIT: "1",
        FAKE_NODE_OUTPUT: missingCredentials ?? "",
        GITHUB_EVENT_NAME: "schedule",
        GITHUB_STEP_SUMMARY: scheduledSummary,
      });
      expect(scheduled.status).toBe(0);
      expect(await readFile(scheduledSummary, "utf8")).toContain(
        "the non-strict scheduled status check did not run",
      );

      const strictDispatch = runWorkflowShell(runScript, fixtureDir, {
        CWS_REQUIRE_PUBLISHED: "true",
        FAKE_NODE_EXIT: "1",
        FAKE_NODE_OUTPUT: missingCredentials ?? "",
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_STEP_SUMMARY: path.join(fixtureDir, "strict-summary.md"),
      });
      expect(strictDispatch.status).toBe(1);
      expect(strictDispatch.stderr).toContain("Missing Chrome Web Store credentials.");

      const serviceAccount = runWorkflowShell(runScript, fixtureDir, {
        CWS_REQUIRE_PUBLISHED: "false",
        CWS_SERVICE_ACCOUNT_JSON: "configured",
        FAKE_CREDENTIAL_FORM: "service-account",
        FAKE_NODE_EXIT: "0",
        FAKE_NODE_OUTPUT: "status-ok",
        GITHUB_EVENT_NAME: "schedule",
        GITHUB_STEP_SUMMARY: path.join(fixtureDir, "service-account-summary.md"),
      });
      expect(serviceAccount.status).toBe(0);

      const oauth = runWorkflowShell(runScript, fixtureDir, {
        CWS_CLIENT_ID: "configured",
        CWS_CLIENT_SECRET: "configured",
        CWS_REFRESH_TOKEN: "configured",
        CWS_REQUIRE_PUBLISHED: "false",
        FAKE_CREDENTIAL_FORM: "oauth",
        FAKE_NODE_EXIT: "0",
        FAKE_NODE_OUTPUT: "status-ok",
        GITHUB_EVENT_NAME: "schedule",
        GITHUB_STEP_SUMMARY: path.join(fixtureDir, "oauth-summary.md"),
      });
      expect(oauth.status).toBe(0);
    } finally {
      await rm(fixtureDir, { force: true, recursive: true });
    }
  });
});

function extractLastWorkflowRunScript(workflow: string): string {
  const marker = "        run: |\n";
  const start = workflow.lastIndexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const lines = workflow.slice(start + marker.length).split("\n");
  const script: string[] = [];

  for (const line of lines) {
    if (line.startsWith("          ")) {
      script.push(line.slice(10));
      continue;
    }
    if (line === "") {
      script.push("");
      continue;
    }
    break;
  }

  return script.join("\n");
}

function runWorkflowShell(
  script: string,
  fixtureDir: string,
  env: Record<string, string>,
): ReturnType<typeof spawnSync> {
  return spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      PATH: `${fixtureDir}:${process.env.PATH ?? ""}`,
    },
  });
}
