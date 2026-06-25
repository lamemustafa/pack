export type LiveRunScenario = "single-period" | "full-year";
export type LiveRunOutcome = "pass" | "blocked" | "failed";

export interface LiveRunEvidence {
  schemaVersion: 1;
  evidenceId: string;
  sourceCommit: string;
  gitTag: string;
  zipSha256: string;
  extensionVersion: string;
  browser: {
    name: "Brave" | "Chrome" | string;
    version: string;
  };
  profile: "clean-test-profile" | string;
  subjectAlias: string;
  scenario: LiveRunScenario;
  startedAt: string;
  completedAt: string;
  outcome: LiveRunOutcome;
  counts: LiveRunEvidenceCounts;
  checks: LiveRunEvidenceChecks;
  redaction: LiveRunEvidenceRedaction;
  mediaArtifacts?: LiveRunEvidenceMediaArtifact[];
}

export interface LiveRunEvidenceCounts {
  eligibleTargets: number;
  downloaded: number;
  notFiled: number;
  manuallyObserved: number;
  blocked: number;
  failed: number;
  duplicates: number;
}

export interface LiveRunEvidenceChecks {
  humanVerifiedAccount: boolean;
  humanVerifiedPeriods: boolean;
  allFilesNonEmpty: boolean;
  serviceWorkerRestartResumeChecked: boolean;
  browserRestartResumeChecked: boolean;
  clearLocalDataChecked: boolean;
  unexpectedNetworkDestinations: number;
}

export interface LiveRunEvidenceRedaction {
  containsGstin: boolean;
  containsPan: boolean;
  containsTaxpayerName: boolean;
  containsFilename: boolean;
  containsPortalUrl: boolean;
  containsLocalPath: boolean;
  containsPdf: boolean;
  containsCookieOrToken: boolean;
  containsPortalHtml: boolean;
  containsScreenshotOrVideo: boolean;
}

export interface LiveRunEvidenceMediaArtifact {
  kind: "screenshot" | "screen-recording" | "other";
  classification: "private-debug-only" | "synthetic-public-demo" | "public-redacted-live-portal";
  redactionMethod: "not-published" | "synthetic-only" | "manual-blur" | string;
  sha256?: string;
}

export type LiveRunEvidenceValidationResult =
  | { ok: true; evidence: LiveRunEvidence }
  | { ok: false; errors: string[] };
