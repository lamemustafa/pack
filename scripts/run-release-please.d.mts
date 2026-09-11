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

/** The heads the run snapshotted, which the later two stages bring up to date and close. */
interface OpenedRewriteRecords extends ReleaseBranchScope {
  headsBeforeRegeneration: Map<string, string>;
}

export function openBranchRewriteRecords(options: ReleaseBranchScope): Promise<Map<string, string>>;

/** `false` when it could not confirm what the regeneration is about to discard. */
export function refreshBranchRewriteRecords(options: OpenedRewriteRecords): Promise<boolean>;

export function closeBranchRewriteRecords(options: OpenedRewriteRecords): Promise<void>;
