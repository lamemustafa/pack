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
// Both directions were wrong before this was numeric.
function isAtLeast(candidate: string, minimum: string): boolean {
  const [aMajor, aMinor, aPatch] = parseVersion(candidate);
  const [bMajor, bMinor, bPatch] = parseVersion(minimum);
  if (aMajor !== bMajor) return aMajor > bMajor;
  if (aMinor !== bMinor) return aMinor > bMinor;
  return aPatch >= bPatch;
}

// Every major named anywhere in a range, so `^24.13.3 || ^26.0.0` reports both rather
// than only the one that happens to appear first.
function majorsIn(range: string): number[] {
  return [...new Set([...range.matchAll(/(\d+)\.\d+\.\d+/gu)].map((m) => Number(m[1])))];
}

async function packageJson(): Promise<{
  engines: { node: string };
  devDependencies: Record<string, string>;
}> {
  return JSON.parse(await readFile("package.json", "utf8")) as {
    engines: { node: string };
    devDependencies: Record<string, string>;
  };
}

describe("node runtime and types alignment", () => {
  it("confines the declared @types/node range to the runtime major", async () => {
    const { engines, devDependencies } = await packageJson();
    const runtimeMajor = parseVersion(engines.node)[0];
    const declared = devDependencies["@types/node"] ?? "";

    // A range spanning majors satisfies a first-number check while resolving to the
    // other side of the range.
    expect(majorsIn(declared)).toEqual([runtimeMajor]);
  });

  it("resolves @types/node to the runtime major in the lockfile", async () => {
    const { engines } = await packageJson();
    const runtimeMajor = parseVersion(engines.node)[0];
    const lockfile = await readFile("pnpm-lock.yaml", "utf8");

    // What is installed, not what is asked for. Immune to range syntax entirely.
    const resolved = /'@types\/node':\s*\n\s*specifier:[^\n]*\n\s*version:\s*([\d.]+)/u.exec(
      lockfile,
    );
    expect(resolved).not.toBeNull();
    expect(parseVersion(resolved?.[1] ?? "")[0]).toBe(runtimeMajor);
  });

  it("pins each workflow to a node version satisfying engines.node", async () => {
    const { engines } = await packageJson();
    const runtimeMajor = parseVersion(engines.node)[0];
    const declaredMinimum = engines.node.replace(/^[^\d]*/u, "");

    const workflows: string[] = [];
    for await (const file of glob(".github/workflows/*.yml")) workflows.push(file);
    expect(workflows.length).toBeGreaterThan(0);

    for (const file of workflows) {
      const text = await readFile(file, "utf8");
      const pins = [...text.matchAll(/node-version:\s*"?([\d.]+)"?/gu)].map((m) => m[1] as string);

      // Per file, not in aggregate: an aggregate count stays positive while one
      // workflow silently loses its pin and runs on the runner's default Node.
      // The objects carry the filename so a failure names which workflow drifted.
      expect({ file, hasPin: pins.length > 0 }).toEqual({ file, hasPin: true });
      for (const pin of pins) {
        expect({ file, pin, major: parseVersion(pin)[0] }).toEqual({
          file,
          pin,
          major: runtimeMajor,
        });
        expect({ file, pin, satisfiesEngines: isAtLeast(pin, declaredMinimum) }).toEqual({
          file,
          pin,
          satisfiesEngines: true,
        });
      }
    }
  });
});
