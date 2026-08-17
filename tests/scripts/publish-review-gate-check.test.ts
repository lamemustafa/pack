import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  ])("maps exit %i to the %s conclusion", (exitCode, conclusion) => {
    const { result, calls } = runPublisher(exitCode);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Review gate check created for ${headSha}`);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("repos/lamemustafa/pack/check-runs");
    expect(calls[0]).toContain("name=Review gate");
    expect(calls[0]).toContain(`head_sha=${headSha}`);
    expect(calls[0]).toContain("status=completed");
    expect(calls[0]).toContain(`conclusion=${conclusion}`);
  });

  it("rejects an unknown evaluator exit code without writing a check", () => {
    const { result, calls } = runPublisher(3);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--exit-code must be 0, 1, or 2");
    expect(calls).toEqual([]);
  });
});

function runPublisher(exitCode: number) {
  const directory = mkdtempSync(path.join(tmpdir(), "pack-review-check-publisher-"));
  const callsPath = path.join(directory, "calls.json");
  const fakeGhPath = path.join(directory, "gh");
  const fakeGhSource = `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const callsPath = ${JSON.stringify(callsPath)};
const calls = existsSync(callsPath) ? JSON.parse(readFileSync(callsPath, "utf8")) : [];
calls.push(process.argv.slice(2));
writeFileSync(callsPath, JSON.stringify(calls), "utf8");
process.stdout.write(JSON.stringify({ id: 1 }));
`;
  writeFileSync(fakeGhPath, fakeGhSource, "utf8");
  chmodSync(fakeGhPath, 0o755);

  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--repo",
      "lamemustafa/pack",
      "--head-sha",
      headSha,
      "--exit-code",
      String(exitCode),
      "--details-url",
      "https://github.com/lamemustafa/pack/actions/runs/1",
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}` },
    },
  );

  const calls = existsSync(callsPath)
    ? (JSON.parse(readFileSync(callsPath, "utf8")) as string[][])
    : [];
  return { result, calls };
}
