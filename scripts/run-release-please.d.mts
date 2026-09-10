export function runReleasePlease(env?: NodeJS.ProcessEnv): Promise<Record<string, string>>;

export function buildReleaseOutputs(
  releases: Array<Record<string, unknown>>,
): Record<string, string>;

export function resolveReleaseTargetBranch(
  env: Partial<Pick<NodeJS.ProcessEnv, "RELEASE_PLEASE_TARGET_BRANCH" | "GITHUB_REF_NAME">>,
  repositoryDefaultBranch: string,
): string;

export function serializeGitHubOutput(outputs: Record<string, string>): string;

export function recordBranchRewrites(options: {
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  owner: string;
  repo: string;
  targetBranch: string;
  headsBeforeRegeneration: Map<string, string>;
  pullRequests: Array<{ number?: number; headBranchName?: string }>;
}): Promise<void>;
