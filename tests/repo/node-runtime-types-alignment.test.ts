import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// `.github/dependabot.yml` suppresses `@types/node` majors because the declared Node API
// surface must describe the Node the code actually runs on. That rule outlives its reason
// the moment the runtime moves, so these assertions are the automation that replaces
// remembering: moving the runtime fails them until `@types/node` moves with it.

function parseVersion(version: string): [number, number, number] {
  const match = /(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (!match) throw new Error(`no semantic version in ${JSON.stringify(version)}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// String comparison orders "24.9.0" above "24.20.0" because it compares "9" against "2".
function isAtLeast(candidate: string, minimum: string): boolean {
  const [aMajor, aMinor, aPatch] = parseVersion(candidate);
  const [bMajor, bMinor, bPatch] = parseVersion(minimum);
  if (aMajor !== bMajor) return aMajor > bMajor;
  if (aMinor !== bMinor) return aMinor > bMinor;
  return aPatch >= bPatch;
}

async function runtimeMajor(): Promise<number> {
  const { engines } = JSON.parse(await readFile("package.json", "utf8")) as {
    engines: { node: string };
  };
  return parseVersion(engines.node)[0];
}

describe("node runtime and types alignment", () => {
  it("resolves @types/node to the runtime major", async () => {
    const lockfile = await readFile("pnpm-lock.yaml", "utf8");

    // The resolved version, not the declared range. Deciding whether a range such as
    // `>=24.13.3` admits a future major means evaluating npm range semantics, which is a
    // parser this repo would be hand-rolling -- and #197 is the record of where that
    // leads. The lockfile states what is installed, cannot be fooled by range syntax, and
    // fails at the moment a resolution actually crosses the major.
    const resolved = /'@types\/node':\s*\n\s*specifier:[^\n]*\n\s*version:\s*([\d.]+)/u.exec(
      lockfile,
    );
    expect(resolved).not.toBeNull();
    expect(parseVersion(resolved?.[1] ?? "")[0]).toBe(await runtimeMajor());
  });

  it("pins every setup-node invocation to a version satisfying engines.node", async () => {
    const { engines } = JSON.parse(await readFile("package.json", "utf8")) as {
      engines: { node: string };
    };
    const major = parseVersion(engines.node)[0];
    const declaredMinimum = engines.node.replace(/^[^\d]*/u, "");

    // Both extensions: GitHub accepts .yml and .yaml, and a guard that reads one of them
    // is green while a workflow in the other runs unchecked.
    const workflows: string[] = [];
    for await (const file of glob(".github/workflows/*.{yml,yaml}")) workflows.push(file);
    expect(workflows.length).toBeGreaterThan(0);

    for (const file of workflows) {
      const text = await readFile(file, "utf8");
      const setupNodeCount = [...text.matchAll(/actions\/setup-node/gu)].length;
      const pins = [...text.matchAll(/node-version:\s*"?([\d.]+)"?/gu)].map((m) => m[1] as string);

      // Counted against setup-node invocations, not once per file. release.yml already
      // runs two of them in separate jobs, so a per-file check stays green while one job
      // loses its pin and falls back to the runner's default Node.
      expect({ file, setupNodeCount, pinCount: pins.length }).toEqual({
        file,
        setupNodeCount,
        pinCount: setupNodeCount,
      });

      for (const pin of pins) {
        expect({ file, pin, major: parseVersion(pin)[0] }).toEqual({ file, pin, major });
        expect({ file, pin, satisfiesEngines: isAtLeast(pin, declaredMinimum) }).toEqual({
          file,
          pin,
          satisfiesEngines: true,
        });
      }
    }
  });
});
