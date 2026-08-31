import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The regression this file exists for is only observable in the emitted
 * bundle: `--mode alpha` once produced a React development build, and neither
 * a config-side-effect assertion nor a synthetic package fixture could see it.
 * Both stay green if WXT hook timing or the Vite React plugin changes, because
 * neither runs the real thing. This one builds it.
 */

const rootDir = process.cwd();
const ALPHA_OUTPUT = path.join(rootDir, ".output", "chrome-mv3-alpha");

function run(command: string, args: readonly string[]): Promise<{ output: string; ok: boolean }> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { cwd: rootDir, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ output: `${stdout}${stderr}`, ok: error === null }),
    );
  });
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(full) : [full];
    }),
  );
  return nested.flat();
}

describe("the emitted alpha artifact", () => {
  it("is a production build that still carries the gated surface", async () => {
    const built = await run("pnpm", ["exec", "wxt", "build", "--mode", "alpha"]);
    expect(built.ok, built.output.slice(-2000)).toBe(true);

    const files = await listFiles(ALPHA_OUTPUT);
    const scripts = files.filter((file) => file.endsWith(".js"));
    expect(scripts.length).toBeGreaterThan(0);

    const sources = await Promise.all(scripts.map((file) => readFile(file, "utf8")));

    // The development transform, named directly rather than inferred from a
    // leaked path: a build made under a directory the redaction policy does not
    // recognise leaks nothing and would otherwise pass.
    for (const marker of ["jsxDEV", "react/jsx-dev-runtime", "react-jsx-dev-runtime"]) {
      expect(
        sources.some((source) => source.includes(marker)),
        `${marker} in the alpha build`,
      ).toBe(false);
    }

    // The absolute source paths a development build inlines, including the
    // builder's home directory.
    for (const source of sources) {
      expect(/\/(?:Users|home|root|workspace)\/[^\s"']+\.tsx?/.test(source)).toBe(false);
    }

    // Still an alpha build: the surface the mode exists to expose is present.
    expect(sources.some((source) => source.includes("data-pack-alpha-surface"))).toBe(true);

    const verified = await run("node", [
      "scripts/verify-extension-package.mjs",
      "--alpha",
      ALPHA_OUTPUT,
    ]);
    expect(verified.output).toContain("alpha extension package verification passed");
    expect(verified.ok).toBe(true);
  }, 600_000);
});
