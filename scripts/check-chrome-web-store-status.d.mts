export interface CheckChromeWebStoreStatusOptions {
  argv?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  write?: (line: string) => void;
}

export interface ChromeWebStoreStatusSummary {
  extensionId: string;
  publisherId: string | null;
  expectedVersion: string | null;
  submittedVersion: string | null;
  publishedVersion: string | null;
  latestObservedVersion: string | null;
  states: string[];
  expectedSubmitted: boolean | null;
  expectedPublished: boolean | null;
  pendingReview: boolean;
  published: boolean;
  failed: boolean;
}

export function checkChromeWebStoreStatus(
  options?: CheckChromeWebStoreStatusOptions,
): Promise<ChromeWebStoreStatusSummary>;

export function summarizeChromeWebStoreStatus(
  status: Record<string, unknown>,
  options?: {
    extensionId?: string;
    expectedVersion?: string;
    publisherId?: string | null;
  },
): ChromeWebStoreStatusSummary;
