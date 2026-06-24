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
});
