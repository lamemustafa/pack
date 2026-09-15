// The Node actually executing this process, checked against what the repository declares.
//
// #333 asked for a YAML parse so each `actions/setup-node` step could be checked for its own
// active `with.node-version`. This asserts the outcome instead of the configuration: whatever a
// workflow pins, drops, comments out, or mistypes, the runtime it produces has to satisfy
// `engines.node` and share a major with the `@types/node` the lockfile resolves.
//
// That is the same move `node-runtime-types-alignment.test.ts` already made and recorded: check
// the thing, not a textual proxy for it. Its four failure modes -- lexical comparison, an
// aggregate count, a per-file count, a commented-out pin -- were all ways of reading *workflow*
// YAML wrongly, and none can occur here because no workflow YAML is read. It also needs no parser
// dependency, which #333 correctly flagged as ask-first.
//
// Not a claim that nothing is parsed. `resolvedTypesNodeVersion` still reads `pnpm-lock.yaml` with
// a regex, and that is a private text format this repository does not own. It is anchored to the
// importer block's indentation and throws rather than guessing when the shape changes, so it fails
// loud in the direction that matters -- but a future lockfile format that still produced a
// `specifier:`/`version:` pair at the same indentation elsewhere could be matched wrongly. Named
// here rather than implied away.
//
// What this does not cover, stated rather than implied: a workflow that never runs Node cannot be
// checked by a Node process, and a pin that is wrong but still inside the declared range passes.
// `engines.node` is the contract; this enforces the contract, not a specific patch version.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Parses the leading `major.minor.patch` of an exact version. Numeric, never lexical. */
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

/**
 * The floor `engines.node` declares, or a reason this checker cannot honour the range it states.
 *
 * Only a bare `>=x.y.z` is honoured. Anything else -- an upper bound, an `||`, a caret or tilde, a
 * wildcard -- expresses a constraint this checker does not evaluate, and reading the first version
 * out of it and calling that the floor would silently ignore the rest. `">=24.20.0 <25.0.0"` would
 * have accepted Node 26, and `"^24.20.0 || >=26.0.0"` would have accepted Node 25; both ranges
 * exclude those runtimes explicitly. Refusing is the fail-closed answer AGENTS.md requires --
 * "could not determine" must never be treated as "matches".
 *
 * A range needing more than a floor is a deliberate act by whoever wrote it, so the honest
 * response is to say the checker cannot enforce it rather than to enforce part of it silently.
 */
export function declaredFloor(engines) {
  const value = String(engines ?? "").trim();
  const match = /^>=\s*v?(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  if (!match) {
    return {
      unsupported: `engines.node is ${JSON.stringify(value)}, which this check cannot fully honour. It evaluates a bare ">=x.y.z" floor only, so an upper bound, an "||", a caret, a tilde or a wildcard would be silently ignored rather than enforced. Either state a bare floor, or extend scripts/assert-node-runtime.mjs to evaluate the range it now declares.`,
    };
  }
  return { floor: [Number(match[1]), Number(match[2]), Number(match[3])] };
}

/** Returns the reasons this runtime is unacceptable. Empty means acceptable. */
export function nodeRuntimeProblems({ runtime, engines, typesNode }) {
  const problems = [];
  const current = parseVersion(runtime);
  const declared = declaredFloor(engines);
  if (declared.unsupported) problems.push(declared.unsupported);
  const minimum = declared.floor;
  if (minimum && !atLeast(current, minimum)) {
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
  // A throw here would surface as an unhandled top-level rejection with a raw stack trace, a worse
  // diagnostic than every other failure this script produces. It fails closed either way; this
  // only makes the reason legible.
  let problems = [];
  try {
    problems = await assertNodeRuntime();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`error: could not check the Node runtime: ${reason}`);
    process.exitCode = 1;
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`error: ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`Node runtime ${process.versions.node} matches the declared engines and types.`);
  }
}
