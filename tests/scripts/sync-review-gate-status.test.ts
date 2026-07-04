import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();
const scriptPath = path.join(rootDir, "scripts", "sync-review-gate-status.mjs");

describe("sync review gate status", () => {
  it("writes the final status when the duplicate-check status read fails", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "pack-sync-review-gate-"));
    const statusLog = path.join(tempDir, "statuses.jsonl");
    const fakeGh = path.join(tempDir, "gh");
    writeFileSync(fakeGh, fakeGhScript(), "utf8");
    chmodSync(fakeGh, 0o755);

    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
        "--repo",
        "lamemustafa/pack",
        "--pr",
        "58",
        "--run-url",
        "https://github.com/lamemustafa/pack/pull/58",
        "--strict-head-review",
        "--required-review-author",
        "chatgpt-codex-connector",
        "--wait-head-review-ms",
        "0",
        "--allow-missing-head-review",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${tempDir}${path.delimiter}${process.env.PATH ?? ""}`,
          STATUS_LOG: statusLog,
        },
      },
    );

    const states = readFileSync(statusLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { state: string });

    expect(output).toContain("PR review gate passed for lamemustafa/pack#58.");
    expect(states.map((status) => status.state)).toEqual(["pending", "success"]);
  });
});

function fakeGhScript() {
  const template = Buffer.from(
    [
      "Pack Workflow Preflight",
      "opened from a Pack branch, not master",
      "latest master Pack AGENTS guidance",
      "required Pack privacy/review/verification checklist visible",
      "Sanchika Adoption Gate",
      "docs/adoption-pack.md",
      "ComplyEaze and Axal completion evidence",
    ].join("\n"),
    "utf8",
  ).toString("base64");

  return `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);

if (args[0] === "pr" && args[1] === "view") {
  console.log(JSON.stringify({
    number: 58,
    headRefOid: "head-sha",
    headRefName: "tapish-codex/review-gate-consistency",
    baseRefName: "master",
    headRepository: { nameWithOwner: "lamemustafa/pack" }
  }));
  process.exit(0);
}

if (args[0] === "api" && args[1] === "repos/lamemustafa/pack/commits/head-sha/statuses") {
  console.error("simulated status read timeout");
  process.exit(1);
}

if (args[0] === "api" && args[1] === "repos/lamemustafa/pack/contents/.github/PULL_REQUEST_TEMPLATE.md?ref=head-sha") {
  console.log(JSON.stringify({ type: "file", content: "${template}" }));
  process.exit(0);
}

if (args[0] === "api" && args[1] === "-X" && args[2] === "POST" && args[3] === "repos/lamemustafa/pack/statuses/head-sha") {
  const stateArg = args.find((arg) => arg.startsWith("state="));
  fs.appendFileSync(process.env.STATUS_LOG, JSON.stringify({ state: stateArg?.slice("state=".length) }) + "\\n");
  console.log("{}");
  process.exit(0);
}

if (args[0] === "api" && args[1] === "graphql") {
  console.log(JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          body: [
            "Pack Workflow Preflight",
            "Privacy And Data-Flow Impact",
            "Sensitive Surface Review",
            "Verification",
            "PR Review Follow-Up",
            "pnpm workflow:preflight"
          ].join("\\n"),
          headRefName: "tapish-codex/review-gate-consistency",
          baseRefName: "master",
          headRepository: { nameWithOwner: "lamemustafa/pack" },
          headRefOid: "head-sha",
          reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
          reviews: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                state: "COMMENTED",
                submittedAt: "2026-07-04T19:55:00Z",
                url: "https://github.com/lamemustafa/pack/pull/58#pullrequestreview-1",
                author: { login: "chatgpt-codex-connector" },
                commit: { oid: "head-sha" }
              }
            ]
          }
        }
      }
    }
  }));
  process.exit(0);
}

console.error("unexpected gh args", JSON.stringify(args));
process.exit(1);
`;
}
