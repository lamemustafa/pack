export function runReleasePlease(env?: NodeJS.ProcessEnv): Promise<Record<string, string>>;

export function buildReleaseOutputs(
  releases: Array<Record<string, unknown>>,
): Record<string, string>;

export function serializeGitHubOutput(outputs: Record<string, string>): string;
