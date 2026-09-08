import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

// The gate is a script rather than inline workflow shell because `chrome-web-store.yml`
// runs it twice -- once before the deployment approval and once after it -- and two
// copies of the same check would be the hand-maintained duplicate this repository's
// defects keep taking as their shape.
describe("store upload enablement gate", () => {
  it("refuses a real upload unless the variable is exactly 'true'", async () => {
    for (const value of ["", "false", "TRUE", "True", "true ", "1", "yes"]) {
      const result = await run({ CWS_SUBMIT_ENABLED: value });

      expect({ value, status: result.status }).toEqual({ value, status: 1 });
      expect(result.output).toContain("Nothing was uploaded");
      expect(result.output).toContain("::error");
    }
  });

  it("allows a real upload when the variable is exactly 'true'", async () => {
    const result = await run({ CWS_SUBMIT_ENABLED: "true" });

    expect(result.status).toBe(0);
  });

  // A dry run validates a package and uploads nothing, so it must stay runnable without
  // the variable -- otherwise the only way to check a package is to enable real uploads.
  it("allows a dry run without the variable", async () => {
    const result = await run({ CWS_DRY_RUN: "true", CWS_SUBMIT_ENABLED: "" });

    expect(result.status).toBe(0);
    expect(result.output).toContain("no upload will occur");
  });

  // The two invocations are distinguishable in the log, so a refusal says whether it
  // happened before an approval was requested or after one was already granted.
  it("names the stage it refused at", async () => {
    const result = await run({ CWS_GUARD_STAGE: "after approval", CWS_SUBMIT_ENABLED: "" });

    expect(result.status).toBe(1);
    expect(result.output).toContain("after approval");
  });
});

async function run(env: Record<string, string>): Promise<{ output: string; status: number }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/require-store-upload-enabled.mjs"],
      { cwd: rootDir, env: { ...process.env, CWS_DRY_RUN: "", CWS_GUARD_STAGE: "", ...env } },
      (error, stdout, stderr) => {
        resolve({
          output: `${stdout}${stderr}`,
          status:
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "number"
              ? error.code
              : error
                ? 1
                : 0,
        });
      },
    );
  });
}
