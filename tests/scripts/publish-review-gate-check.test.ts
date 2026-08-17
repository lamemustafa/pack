import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();
const scriptPath = path.join(rootDir, "scripts", "publish-review-gate-check.mjs");
const headSha = "a".repeat(40);

describe("PR-head Review gate check publisher", () => {
  it.each([
    [0, "success"],
    [1, "failure"],
    [2, "action_required"],
  ])("maps exit %i to the %s Review gate conclusion", (exitCode, conclusion) => {
    const { result, calls } = runPublisher(exitCode, [{ status: 0 }]);
    expect(result.status).toBe(0);
    const call = calls[0]?.join(" ") ?? "";
    expect(call).toContain("repos/lamemustafa/pack/check-runs");
    expect(call).toContain("name=Review gate");
    expect(call).toContain(`head_sha=${headSha}`);
    expect(call).toContain(`conclusion=${conclusion}`);
  });

  it.each([
    ["succeeds after retry", [1, 0], 0],
    ["reports exhaustion", [1, 1], 2],
  ])("%s for transient check publication", (_name, statuses, expectedExit) => {
    const responses = statuses.map((status) => ({
      status,
      stderr: status ? "gh: HTTP 503\n" : "",
    }));
    const { result, calls } = runPublisher(1, responses);
    expect(result.status).toBe(expectedExit);
    if (expectedExit === 2) expect(result.stderr).toContain("failed after 2 attempts");
    expect(calls).toHaveLength(2);
  });

  it("selects only open non-draft same-repository PRs and logs skips and the cap", () => {
    const pulls = [
      pull(1),
      pull(2, { draft: true }),
      pull(3, { state: "closed" }),
      pull(4, { headRepo: "external/pack" }),
      pull(5),
    ];
    const { result, calls } = runScript(
      ["--reconcile-open-prs", "--max-prs", "1"],
      pulls,
      cleanReviewFixture(),
    );
    const publications = calls.filter((call) => call.includes("repos/lamemustafa/pack/check-runs"));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Skipping #2: pull request is a draft");
    expect(result.stdout).toContain("Skipping #3: pull request is not open");
    expect(result.stdout).toContain("Skipping #4: fork head external/pack");
    expect(result.stderr).toContain("schedule cap hit: processing 1 of 2 eligible");
    expect(publications).toHaveLength(1);
    expect(publications[0]).toContain(`head_sha=${headSha}`);
  });
});

function runPublisher(exitCode: number, responses: Array<{ status: number; stderr?: string }>) {
  return runScript(["--head-sha", headSha, "--exit-code", String(exitCode)], [], {}, responses);
}

function runScript(
  modeArgs: string[],
  pulls: unknown[] = [],
  fixture: unknown = {},
  responses: Array<{ status: number; stderr?: string }> = [{ status: 0 }],
) {
  const directory = mkdtempSync(path.join(tmpdir(), "pack-review-publisher-"));
  const callsPath = path.join(directory, "calls.json");
  const fakeGhPath = path.join(directory, "gh");
  writeFileSync(fakeGhPath, fakeGhSource, "utf8");
  chmodSync(fakeGhPath, 0o755);
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--repo",
      "lamemustafa/pack",
      "--details-url",
      "https://github.com/lamemustafa/pack/actions/runs/1",
      ...modeArgs,
      "--retry-attempts",
      String(responses.length),
      "--retry-backoff-ms",
      "0",
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_CALLS: callsPath,
        FAKE_FIXTURE: JSON.stringify(fixture),
        FAKE_PULLS: JSON.stringify([pulls]),
        FAKE_RESPONSES: JSON.stringify(responses),
      },
    },
  );
  const calls = readFileSync(callsPath, "utf8");
  return { result, calls: JSON.parse(calls) as string[][] };
}

const fakeGhSource = `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const calls = existsSync(process.env.FAKE_CALLS) ? JSON.parse(readFileSync(process.env.FAKE_CALLS, "utf8")) : [];
calls.push(args); writeFileSync(process.env.FAKE_CALLS, JSON.stringify(calls), "utf8");
const text = args.join(" ");
if (text.includes("pulls?state=open")) process.stdout.write(process.env.FAKE_PULLS);
else if (text.includes("graphql")) process.stdout.write(process.env.FAKE_FIXTURE);
else if (text.includes("check-runs")) {
  const attempts = calls.filter((call) => call.includes("repos/lamemustafa/pack/check-runs")).length;
  const responses = JSON.parse(process.env.FAKE_RESPONSES);
  const response = responses[Math.min(attempts - 1, responses.length - 1)];
  if (response.stderr) process.stderr.write(response.stderr);
  process.exit(response.status);
} else process.exit(1);
`;

function pull(
  number: number,
  { draft = false, state = "open", headRepo = "lamemustafa/pack" } = {},
) {
  const sha = number === 1 ? headSha : String(number).repeat(40);
  return {
    number,
    state,
    draft,
    head: { sha, repo: { full_name: headRepo } },
  };
}

const cleanReviewFixture = () => ({
  data: {
    repository: {
      pullRequest: {
        body: "Pack Workflow Preflight\nPrivacy And Data-Flow Impact\nSensitive Surface Review\nVerification\nPR Review Follow-Up\npnpm workflow:preflight",
        headRefName: "tapish-codex/test",
        headRepository: { nameWithOwner: "lamemustafa/pack" },
        headRefOid: headSha,
      },
    },
  },
});
