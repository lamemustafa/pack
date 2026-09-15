// Hand-written, and TypeScript resolves this in preference to the `.mjs` beside it — so a change
// to the implementation's signature that is not made here is invisible to every caller until CI
// rejects it. `scripts/run-release-please.d.mts` cost a round exactly that way. Keep this minimal:
// the smaller the surface restated here, the less there is to drift.

/** `[major, minor, patch]`, parsed numerically from the leading version in an exact version. */
export type SemanticVersion = [number, number, number];

/** Throws on anything without a leading `x.y.z`; ranges go through `declaredFloor` instead. */
export function parseVersion(value: unknown): SemanticVersion;

/**
 * The floor a bare `>=x.y.z` declares, or a reason the range cannot be fully honoured.
 *
 * Only a bare floor is evaluated. An upper bound, an `||`, a caret, a tilde or a wildcard returns
 * `unsupported` rather than a partially-enforced floor, so a runtime a range explicitly excludes
 * is never silently accepted.
 */
export function declaredFloor(
  engines: unknown,
): { floor: SemanticVersion; unsupported?: undefined } | { unsupported: string; floor?: undefined };

/** `true` when `candidate` is the same as or newer than `minimum`. */
export function atLeast(candidate: SemanticVersion, minimum: SemanticVersion): boolean;

/** The `@types/node` version the lockfile's importer block resolves, not a peer declaration. */
export function resolvedTypesNodeVersion(lockfile: string): string;

/** The reasons this runtime is unacceptable. Empty means acceptable. */
export function nodeRuntimeProblems(input: {
  runtime: string;
  engines: string;
  typesNode: string;
}): string[];

/** Reads this repository's `package.json` and `pnpm-lock.yaml`; returns the problems found. */
export function assertNodeRuntime(options?: { runtime?: string; root?: string }): Promise<string[]>;
