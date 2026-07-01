export interface PublishChromeWebStoreOptions {
  argv?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  sleepImpl?: (ms: number) => Promise<void>;
  write?: (line: string) => void;
}

export interface PublishRequest {
  blockOnWarnings: boolean;
  deployInfos?: Array<{ deployPercentage: number }>;
}

export function publishChromeWebStorePackage(
  options?: PublishChromeWebStoreOptions,
): Promise<Record<string, unknown> & { publishRequest?: PublishRequest }>;

export function buildPublishRequest(options?: {
  blockOnWarnings?: boolean;
  deployPercentage?: string | number | null;
}): PublishRequest;
