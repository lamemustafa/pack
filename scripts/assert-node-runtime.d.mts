// Hand-written, and TypeScript resolves this in preference to the `.mjs` beside it — so a change
// to the implementation's signature that is not made here is invisible to every caller until CI
// rejects it. `scripts/run-release-please.d.mts` cost a round exactly that way. Keep this minimal:
// the smaller the surface restated here, the less there is to drift.

/** `[major, minor, patch]`, parsed numerically from the leading version in a version or range. */
export type SemanticVersion = [number, number, number];

export function parseVersion(value: unknown): SemanticVersion;

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
