import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  assertNodeRuntime,
  atLeast,
  nodeRuntimeProblems,
  parseVersion as parseRuntimeVersion,
  resolvedTypesNodeVersion,
} from "../../scripts/assert-node-runtime.mjs";

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

// #333: workflow `node-version` pins can drift from `engines.node` with nothing to notice. Four
// review rounds on #331 established that reading those pins out of YAML with regexes cannot be
// done correctly, and a parser is a dependency this repo treats as ask-first.
//
// `scripts/assert-node-runtime.mjs` checks the runtime the workflow actually produced instead of
// the configuration that was supposed to produce it. Every failure mode #331 enumerated is a way
// of misreading YAML, and none of them survives not reading any.
describe("node runtime assertion", () => {
  it("compares versions numerically, not lexically", () => {
    // The first hole #331 found: `"24.9.0" >= "24.20.0"` is true as a string and false as a
    // version, and `"26.10.0" >= "26.4.1"` is false as a string and true as a version. Both
    // directions, so a lexical comparison is not merely conservative.
    expect(atLeast(parseRuntimeVersion("24.9.0"), parseRuntimeVersion("24.20.0"))).toBe(false);
    expect(atLeast(parseRuntimeVersion("26.10.0"), parseRuntimeVersion("26.4.1"))).toBe(true);
    expect(atLeast(parseRuntimeVersion("24.20.0"), parseRuntimeVersion("24.20.0"))).toBe(true);
  });

  it("rejects a runtime below the declared minimum", () => {
    // A pin below the floor, and a dropped pin whose runner default is older, both land here.
    const problems = nodeRuntimeProblems({
      runtime: "24.9.0",
      engines: ">=24.20.0",
      typesNode: "24.13.4",
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("older than the declared minimum");
  });

  it("rejects a runtime whose major the installed types do not describe", () => {
    // The case a minimum alone cannot catch: a lost or commented-out pin whose runner default is
    // *newer*. Node 26 satisfies `>=24.20.0` while `@types/node` still describes Node 24, so tsc
    // would approve calls that do not exist at execution -- the risk the dependabot ignore rule
    // for `@types/node` majors exists to cover.
    const problems = nodeRuntimeProblems({
      runtime: "26.0.0",
      engines: ">=24.20.0",
      typesNode: "24.13.4",
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("@types/node resolves to");
  });

  it("reports both problems at once rather than stopping at the first", () => {
    const problems = nodeRuntimeProblems({
      runtime: "22.0.0",
      engines: ">=24.20.0",
      typesNode: "24.13.4",
    });
    expect(problems).toHaveLength(2);
  });

  it("accepts a runtime that satisfies both", () => {
    expect(
      nodeRuntimeProblems({ runtime: "24.20.0", engines: ">=24.20.0", typesNode: "24.13.4" }),
    ).toEqual([]);
  });

  it("reads the resolved @types/node, not a peer entry further down the graph", () => {
    // The importer block is indented six spaces; peer declarations in the dependency graph are
    // indented differently and would otherwise answer first, reporting a version nothing installs.
    const lockfile = [
      "importers:",
      "  .:",
      "    devDependencies:",
      "      '@types/node':",
      "        specifier: ^24.13.4",
      "        version: 24.13.4",
      "packages:",
      "  some-package@1.0.0:",
      "    peerDependencies:",
      "      '@types/node': ^26.0.0",
    ].join("\n");
    expect(resolvedTypesNodeVersion(lockfile)).toBe("24.13.4");
  });

  it("names a missing @types/node entry instead of silently passing", () => {
    expect(() => resolvedTypesNodeVersion("importers:\n  .:\n")).toThrow(
      /no resolved @types\/node/u,
    );
  });

  it("checks this repository's real package.json and lockfile", async () => {
    // Reads the actual files rather than fixtures, so a change to either shape is caught here
    // instead of at the moment a workflow runs.
    await expect(assertNodeRuntime({ runtime: "24.20.0" })).resolves.toEqual([]);
  });
});
