export function runReleasePlease(env?: NodeJS.ProcessEnv): Promise<Record<string, string>>;

export function buildReleaseOutputs(
  releases: Array<Record<string, unknown>>,
): Record<string, string>;

export function resolveReleaseTargetBranch(
  env: Partial<Pick<NodeJS.ProcessEnv, "RELEASE_PLEASE_TARGET_BRANCH" | "GITHUB_REF_NAME">>,
  repositoryDefaultBranch: string,
): string;

export function serializeGitHubOutput(outputs: Record<string, string>): string;

interface ReleaseBranchScope {
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  owner: string;
  repo: string;
  targetBranch: string;
}

/**
 * One opened rewrite record.
 *
 * `recordHomeIsOpen` is `false` when the marker had to be written to a closed pull request
 * because the generated branch outlived its release pull request. The head is still named -- that
 * is what the review gate needs -- but nothing is being claimed about continuity for a review
 * that is already closed, and the rewrite must re-check that no pull request has appeared before
 * it force-pushes.
 */
interface BranchRewriteRecord {
  head: string;
  recordId: number;
  pullRequestNumber: number;
  recordHomeIsOpen?: boolean;
}

/** The heads and durable marker identities opened for this regeneration. */
interface OpenedRewriteRecords extends ReleaseBranchScope {
  headsBeforeRegeneration: Map<string, BranchRewriteRecord>;
}

export function openBranchRewriteRecords(
  options: ReleaseBranchScope,
): Promise<Map<string, BranchRewriteRecord>>;

/** `false` when it could not confirm what the regeneration is about to discard. */
export function refreshBranchRewriteRecords(options: OpenedRewriteRecords): Promise<boolean>;

export function closeBranchRewriteRecords(options: {
  env: ReleaseBranchScope["env"];
  owner: string;
  repo: string;
  confirmedRewrites: Map<
    string,
    { record: { id: number; marker: { branch: string; before: string } }; after: string }
  >;
}): Promise<unknown[]>;

export function withReleaseBranchRewriteCas<T>(
  github: {
    repository: { owner: string; repo: string };
    graphql: (query: string, variables: Record<string, unknown>) => Promise<unknown>;
    octokit: {
      git: {
        createRef: (request: Record<string, unknown>) => Promise<unknown>;
        updateRef: (request: Record<string, unknown>) => Promise<unknown>;
      };
    };
  },
  expected: OpenedRewriteRecords["headsBeforeRegeneration"],
  confirmedRewrites: Map<
    string,
    { record: { id: number; marker: { branch: string; before: string } }; after: string }
  >,
  operation: () => Promise<T>,
  /**
   * Resolves to the number of an open pull request for `branch`, or `null` when none is open.
   *
   * Consulted for closed-home records immediately before the compare-and-swap, which is the last
   * instant at which the answer still matters: `refreshBranchRewriteRecords` checks earlier, but
   * that runs before Release Please has built the commit.
   *
   * Optional, and omitting it is safe by construction rather than by convention: a closed-home
   * rewrite with no checker is refused, not waved through. Callers that never produce a
   * closed-home record therefore need not supply one.
   */
  assertNoPullRequestOpened?: ((branch: string) => Promise<number | null>) | null,
): Promise<T>;
