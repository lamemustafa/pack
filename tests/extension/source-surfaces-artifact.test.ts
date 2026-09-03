import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The regression this file exists for is only observable in the emitted
 * bundle: `--mode source-surfaces` once produced a React development build, and neither
 * a config-side-effect assertion nor a synthetic package fixture could see it.
 * Both stay green if WXT hook timing or the Vite React plugin changes, because
 * neither runs the real thing. This one builds it.
 */

const rootDir = process.cwd();
const SOURCE_SURFACES_OUTPUT = path.join(rootDir, ".output", "chrome-mv3-source-surfaces");

function pnpmCommandFor(platform: NodeJS.Platform): string {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

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

describe("the emitted source-surfaces artifact", () => {
  it("uses the Windows pnpm executable when that platform runs the artifact test", () => {
    expect(pnpmCommandFor("win32")).toBe("pnpm.cmd");
    expect(pnpmCommandFor("darwin")).toBe("pnpm");
  });

  it("is a production build that still carries the gated surface", async () => {
    // A successful process exit is not evidence that WXT refreshed this
    // directory. Clear a deliberately stale artifact first, then assert the
    // build is the source of every inspected file below.
    await mkdir(SOURCE_SURFACES_OUTPUT, { recursive: true });
    const staleProof = path.join(SOURCE_SURFACES_OUTPUT, "stale-source-surfaces-artifact-proof");
    await writeFile(staleProof, "stale");
    await rm(SOURCE_SURFACES_OUTPUT, { force: true, recursive: true });
    await expect(readFile(staleProof, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const built = await run(pnpmCommandFor(process.platform), [
      "exec",
      "wxt",
      "build",
      "--mode",
      "source-surfaces",
    ]);
    expect(built.ok, built.output.slice(-2000)).toBe(true);

    const files = await listFiles(SOURCE_SURFACES_OUTPUT);
    const scripts = files.filter((file) => file.endsWith(".js"));
    expect(scripts.length).toBeGreaterThan(0);

    const sources = await Promise.all(scripts.map((file) => readFile(file, "utf8")));

    // The development transform, named directly rather than inferred from a
    // leaked path: a build made under a directory the redaction policy does not
    // recognise leaks nothing and would otherwise pass.
    for (const marker of ["jsxDEV", "react/jsx-dev-runtime", "react-jsx-dev-runtime"]) {
      expect(
        sources.some((source) => source.includes(marker)),
        `${marker} in the source-surfaces build`,
      ).toBe(false);
    }

    // The absolute source paths a development build inlines, including the
    // builder's home directory.
    for (const source of sources) {
      expect(/\/(?:Users|home|root|workspace)\/[^\s"']+\.tsx?/.test(source)).toBe(false);
    }

    // Still a source-surfaces build: the surface the mode exists to expose is present.
    expect(sources.some((source) => source.includes("data-pack-source-surface"))).toBe(true);

    const verified = await run("node", [
      "scripts/verify-extension-package.mjs",
      "--source-surfaces",
      SOURCE_SURFACES_OUTPUT,
    ]);
    expect(verified.output).toContain("source-surfaces extension package verification passed");
    expect(verified.ok).toBe(true);

    const browserVerified = await run("node", [
      "scripts/verify-extension-browser.mjs",
      "--source-surfaces",
      SOURCE_SURFACES_OUTPUT,
    ]);
    expect(browserVerified.output).toContain('"status": "pass"');
    expect(browserVerified.ok).toBe(true);

    const mistypedBrowserFlag = await run("node", [
      "scripts/verify-extension-browser.mjs",
      "--source-surface",
      SOURCE_SURFACES_OUTPUT,
    ]);
    expect(mistypedBrowserFlag.ok).toBe(false);
    expect(mistypedBrowserFlag.output).toContain(
      "usage: node scripts/verify-extension-browser.mjs",
    );
  }, 600_000);
});
