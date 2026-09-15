// The Node actually executing this process, checked against what the repository declares.
//
// #333 asked for a YAML parse so each `actions/setup-node` step could be checked for its own
// active `with.node-version`. This asserts the outcome instead of the configuration: whatever a
// workflow pins, drops, comments out, or mistypes, the runtime it produces has to satisfy
// `engines.node` and share a major with the `@types/node` the lockfile resolves.
//
// That is the same move `node-runtime-types-alignment.test.ts` already made and recorded: check
// the thing, not a textual proxy for it. Its four failure modes -- lexical comparison, an
// aggregate count, a per-file count, a commented-out pin -- were all ways of reading YAML wrongly.
// None of them can occur here, because no YAML is read. It also needs no parser dependency, which
// #333 correctly flagged as ask-first.
//
// What this does not cover, stated rather than implied: a workflow that never runs Node cannot be
// checked by a Node process, and a pin that is wrong but still inside the declared range passes.
// `engines.node` is the contract; this enforces the contract, not a specific patch version.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Parses the leading `major.minor.patch` of a version or range. Numeric, never lexical. */
export function parseVersion(value) {
  const match = /(\d+)\.(\d+)\.(\d+)/u.exec(String(value ?? ""));
  if (!match) throw new Error(`no semantic version in ${JSON.stringify(value)}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** `true` when `candidate` is the same as or newer than `minimum`, compared component by component. */
export function atLeast(candidate, minimum) {
  for (let index = 0; index < 3; index += 1) {
    if (candidate[index] > minimum[index]) return true;
    if (candidate[index] < minimum[index]) return false;
  }
  return true;
}

/**
 * The `@types/node` version the lockfile resolves, not the range `package.json` declares.
 *
 * Anchored to the importer block's indentation: the dependency graph further down lists
 * `@types/node` as a peer of many packages, and matching one of those would report a version
 * nothing installs.
 */
export function resolvedTypesNodeVersion(lockfile) {
  const match = /^\s{6}'@types\/node':\n\s{8}specifier:[^\n]*\n\s{8}version:\s*([^\n(]+)/mu.exec(
    lockfile,
  );
  if (!match) throw new Error("no resolved @types/node version in pnpm-lock.yaml");
  return match[1].trim();
}

/** Returns the reasons this runtime is unacceptable. Empty means acceptable. */
export function nodeRuntimeProblems({ runtime, engines, typesNode }) {
  const problems = [];
  const current = parseVersion(runtime);
  const minimum = parseVersion(engines);
  if (!atLeast(current, minimum)) {
    problems.push(
      `Node ${runtime} is older than the declared minimum ${engines}. A workflow pin below the floor, a dropped pin falling back to the runner default, or a local toolchain that was never upgraded all look like this.`,
    );
  }
  const typesMajor = parseVersion(typesNode)[0];
  if (current[0] !== typesMajor) {
    problems.push(
      `Node ${runtime} is major ${current[0]} but @types/node resolves to ${typesNode}, major ${typesMajor}. The declared API surface would describe a runtime that is not executing, so tsc would approve calls that do not exist at execution.`,
    );
  }
  return problems;
}

export async function assertNodeRuntime({
  runtime = process.versions.node,
  root = repositoryRoot,
} = {}) {
  const { engines } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const lockfile = await readFile(path.join(root, "pnpm-lock.yaml"), "utf8");
  return nodeRuntimeProblems({
    runtime,
    engines: engines.node,
    typesNode: resolvedTypesNodeVersion(lockfile),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = await assertNodeRuntime();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`error: ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`Node runtime ${process.versions.node} matches the declared engines and types.`);
  }
}
