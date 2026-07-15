export type LiveRunScenario = "single-period" | "full-year";
export type LiveRunOutcome = "pass" | "blocked" | "failed";
export type LiveRunReturnType = "GSTR-3B" | "GSTR-1" | "GSTR-2B";
export type LiveRunArtifactType = "PDF" | "EXCEL" | "PDF_AND_EXCEL";
export type LiveRunDownloadPathClass =
  | "extension-direct-https"
  | "extension-direct-blob"
  | "extension-direct-data"
  | "extension-direct-unknown"
  | "portal-click-https"
  | "portal-click-blob"
  | "portal-click-data"
  | "portal-click-unknown"
  | "portal-click-after-direct-fallback-https"
  | "portal-click-after-direct-fallback-blob"
  | "portal-click-after-direct-fallback-data"
  | "portal-click-after-direct-fallback-unknown"
  | "captured-portal-request-https"
  | "captured-portal-request-blob"
  | "captured-portal-request-data"
  | "captured-portal-request-unknown";
export type LiveRunEndpointClass =
  | "gstr3b-getgenpdf"
  | "gstr3b-portal-rendered-download"
  | "gstr3b-portal-blob-captured-download"
  | "gstr1-pdf-portal-rendered-download"
  | "gstr1-excel-portal-rendered-download"
  | "gstr1-pdf-portal-blob-captured-download"
  | "gstr1-excel-portal-blob-captured-download"
  | "gstr2b-portal-blob-captured-download"
  | "filed-return-portal-rendered-download"
  | "unknown";
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
  downloadEvidence: LiveRunDownloadEvidence[];
  limitations?: LiveRunEvidenceLimitation[];
  redaction: LiveRunEvidenceRedaction;
  mediaArtifacts?: LiveRunEvidenceMediaArtifact[];
}

export interface LiveRunDownloadEvidence {
  actionId: string;
  returnType: LiveRunReturnType;
  artifactType: "PDF" | "EXCEL";
  financialYear: string;
  period: string;
  endpointClass: LiveRunEndpointClass;
  downloadPathClass: LiveRunDownloadPathClass;
  status:
    | "downloaded"
    | "not-filed"
    | "unavailable-on-portal"
    | "user-action-required"
    | "unsupported"
    | "blocked"
    | "failed";
  askWhereToSave: "on" | "off" | "unknown";
  filenameCollision: "present" | "absent" | "unknown";
  multipleDownloadPrompt: "shown" | "not-shown" | "unknown";
  exactZipBuild: string;
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
