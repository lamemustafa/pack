export type LiveRunScenario = "single-period" | "full-year";
export type LiveRunOutcome = "pass" | "blocked" | "failed";
export type LiveRunReturnType = "GSTR-3B" | "GSTR-1";
export type LiveRunArtifactType = "PDF" | "EXCEL" | "PDF_AND_EXCEL";
export type LiveRunEvidenceLimitation =
  | "clean-profile-not-verified"
  | "human-account-match-not-verified"
  | "human-period-match-not-verified"
  | "file-non-empty-check-not-verified"
  | "service-worker-restart-not-verified"
  | "browser-restart-not-verified"
  | "clear-local-data-not-verified"
  | "browser-state-not-captured";

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
  returnType: LiveRunReturnType;
  artifactType: LiveRunArtifactType;
  financialYear: string;
  period: string;
  scenario: LiveRunScenario;
  startedAt: string;
  completedAt: string;
  outcome: LiveRunOutcome;
  counts: LiveRunEvidenceCounts;
  checks: LiveRunEvidenceChecks;
  limitations?: LiveRunEvidenceLimitation[];
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
  browserSummaryCaptured: boolean;
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
  { ok: true; evidence: LiveRunEvidence } | { ok: false; errors: string[] };
