import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// `.github/dependabot.yml` suppresses `@types/node` majors because the declared Node API
// surface must describe the Node the code actually runs on. That rule outlives its reason
// the moment the runtime moves, so this is the automation that replaces remembering:
// moving `engines.node` fails the suite until `@types/node` moves with it.

function parseVersion(version: string): [number, number, number] {
  const match = /(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (!match) throw new Error(`no semantic version in ${JSON.stringify(version)}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

describe("node runtime and types alignment", () => {
  it("resolves @types/node to the runtime major", async () => {
    const { engines } = JSON.parse(await readFile("package.json", "utf8")) as {
      engines: { node: string };
    };
    const lockfile = await readFile("pnpm-lock.yaml", "utf8");

    // Deliberately one assertion, against the resolved version rather than the declared
    // range or the workflow pins.
    //
    // Earlier revisions also parsed the npm range and the workflow YAML. Both were
    // guesses at grammars this repo does not own, and review found four ways they passed
    // while broken: lexical version comparison, an aggregate count that stayed positive
    // when one file lost its pin, a per-file count that stayed positive when one of two
    // `setup-node` steps lost its pin, and finally a commented-out pin that satisfies any
    // regex while GitHub ignores it. Each fix was correct and produced the next hole,
    // because closing them properly needs a YAML parser and an npm range evaluator.
    //
    // The lockfile states what is installed. It cannot be commented out, cannot be
    // written as a range, and fails at the moment a resolution crosses the major -- which
    // is the risk the dependabot rule exists to cover. Workflow pins drifting from
    // `engines.node` is a real but separate concern, tracked as its own issue rather than
    // guarded here by approximation.
    const resolved = /'@types\/node':\s*\n\s*specifier:[^\n]*\n\s*version:\s*([\d.]+)/u.exec(
      lockfile,
    );
    expect(resolved).not.toBeNull();
    expect(parseVersion(resolved?.[1] ?? "")[0]).toBe(parseVersion(engines.node)[0]);
  });
});
