import type { FiledReturnsReturnType } from "./filed-returns-return-types";
import type {
  FiledReturnsArtifactType,
  FiledReturnsConcreteArtifactType,
} from "./filed-returns-artifacts";

export type ConnectorId = "gst" | string;
export type ExecutionMode = "local-browser" | "ucp-managed";

export type SourceKind =
  | "portal-original"
  | "government-structured-data"
  | "pack-generated-index"
  | "pack-generated-report";

export type TerminalStatus =
  | "downloaded"
  | "not-filed"
  | "not-applicable"
  | "unavailable-on-portal"
  | "generation-pending"
  | "cancelled-by-user"
  | "failed-retryable-exhausted"
  | "failed-permanent"
  | "unknown";

export interface PortalConnectorDescriptor {
  id: ConnectorId;
  version: string;
  displayName: string;
  supportedOrigins: string[];
  supportedDocumentTypes: string[];
  compatibilityVersion: string;
}

export interface LocalSubjectRef {
  type: "GSTIN" | "PAN" | "local-label" | string;
  value: string;
  displayValue?: string;
  sensitivity: "personal-or-business";
}

export interface DownloadScope {
  subjectRef?: LocalSubjectRef;
  financialYears: string[];
  periods: string[];
  documentTypes: string[];
  formats: string[];
  sourcePreference: "portal-original-only" | "portal-original-and-data";
}

export interface DownloadTarget {
  targetId: string;
  documentType: string;
  period?: string;
  financialYear?: string;
  requestedFormat?: string;
  expectedSourceKind: SourceKind;
  applicability: "expected" | "possible" | "unknown";
  dependencyTargetIds?: string[];
}

export interface DownloadPlan {
  schemaVersion: "1.0";
  planId: string;
  connector: PortalConnectorDescriptor;
  createdAt: string;
  executionMode: ExecutionMode;
  scope: DownloadScope;
  targets: DownloadTarget[];
  disclosuresAccepted: string[];
}

export interface FileEvidence {
  sourceKind: SourceKind;
  originalFilename?: string;
  normalisedFilename: string;
  relativePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  integrityState: "verified" | "not-computed" | "mismatch";
}

export interface AllowListedPortalMetadata {
  filingStatus?: string;
  arn?: string;
  filingDate?: string;
  taxPeriod?: string;
}

export interface DownloadError {
  code:
    | "UNSUPPORTED_PAGE"
    | "SESSION_EXPIRED"
    | "USER_LOGIN_REQUIRED"
    | "PORTAL_ELEMENT_NOT_FOUND"
    | "PORTAL_GENERATION_TIMEOUT"
    | "DOWNLOAD_BLOCKED_BY_BROWSER"
    | "DOWNLOAD_ZERO_BYTES"
    | "DUPLICATE_FILE"
    | "PERMISSION_DENIED"
    | "CONNECTOR_INCOMPATIBLE"
    | "UNKNOWN_SAFE_ERROR";
  retryable: boolean;
  safeMessage: string;
  diagnosticContext?: Record<string, string | number | boolean>;
}

export interface UserActionRequired {
  type:
    | "LOGIN"
    | "COMPLETE_CAPTCHA"
    | "COMPLETE_OTP"
    | "NAVIGATE_TO_SUPPORTED_PAGE"
    | "ALLOW_MULTIPLE_DOWNLOADS"
    | "RETRY_PORTAL_GENERATION"
    | "WAIT_FOR_PORTAL_AVAILABILITY";
  message: string;
  canResume: boolean;
}

export interface DownloadResult {
  schemaVersion: "1.0";
  targetId: string;
  status: TerminalStatus;
  startedAt?: string;
  completedAt: string;
  artifact?: FileEvidence;
  portalMetadata?: AllowListedPortalMetadata;
  error?: DownloadError;
  userAction?: UserActionRequired;
}

export interface PortalContext {
  connectorId: ConnectorId;
  supported: boolean;
  origin?: string;
  pageKind:
    | "gst-filed-returns"
    | "gst-auth-landing"
    | "supported-gst-return-page"
    | "gst-portal"
    | "unsupported"
    | "unknown";
  safeTitle?: string;
  requiredAction?: UserActionRequired;
}

export interface PortalObservation {
  connectorId: ConnectorId;
  pageKind: PortalContext["pageKind"];
  scopeId: string;
  state: string;
  safeSignals: string[];
  safeMessage: string;
  userAction?: UserActionRequired;
}

export interface PortalRequestShape {
  connectorId: ConnectorId;
  origin: string;
  pathShape: string;
  initiatorType: string;
}

export interface PortalNavigationResult {
  connectorId: ConnectorId;
  scopeId: string;
  state: "clicked" | "candidate-not-found" | "unsupported-page" | "blocked" | "login-required";
  safeSignals: string[];
  safeMessage: string;
  userAction?: UserActionRequired;
}

export interface PortalDownloadTriggerResult {
  connectorId: ConnectorId;
  scopeId: string;
  state:
    | "clicked"
    | "downloaded"
    | "download-unconfirmed"
    | "candidate-not-found"
    | "unsupported-page"
    | "blocked"
    | "login-required";
  safeSignals: string[];
  safeMessage: string;
  userAction?: UserActionRequired;
}

export interface FiledReturnsDownloadScope {
  financialYear: string;
  period: string;
  returnType: FiledReturnsReturnType;
  artifactType?: FiledReturnsArtifactType;
  completedPeriods?: string[];
}

export interface FiledReturnsTargetBoundViewPoint {
  x: number;
  y: number;
}

export interface FiledReturnsDownloadTarget {
  actionId: string;
  financialYear: string;
  period: string;
  returnType: FiledReturnsReturnType;
  artifactType?: FiledReturnsConcreteArtifactType;
  /** Internal explicit portal-click mode with target-bound blob/data observation. */
  forcePortalClick?: boolean;
}

export interface FiledReturnsDirectDownloadRequest {
  actionId: string;
  url: string;
  safeSignals: string[];
}

export interface FiledReturnsCapturedDownloadRequest {
  actionId: string;
  dataUrl: string;
  safeSignals: string[];
}

export interface FiledReturnsMainWorldCaptureRequest {
  actionId: string;
  controlAttribute: string;
  controlId: string;
  maxBytes: number;
  signalPrefix: string;
  timeoutMs?: number;
  transferId?: string;
  transferChunkSize?: number;
}

export interface FiledReturnsTargetReview {
  schemaVersion: "1.0";
  targetId: string;
  status: "download-unconfirmed";
  scope: FiledReturnsDownloadScope;
  safeSignals: string[];
  safeMessage: string;
  updatedAt: string;
}

export type FiledReturnsDownloadEndpointClass =
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

export type FiledReturnsDownloadPathClass =
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

export type FiledReturnsDownloadMimeClass =
  | "pdf"
  | "spreadsheet"
  | "generic-binary"
  | "html"
  | "json"
  | "text"
  | "image"
  | "other"
  | "missing";

export type FiledReturnsDownloadByteCountClass = "non-empty" | "zero" | "unknown" | "missing";

export interface BrowserDownloadSafeEvidence {
  downloadId?: number;
  urlClass: "https" | "blob" | "data" | "unknown";
  mimeClass: FiledReturnsDownloadMimeClass;
  byteCountClass: FiledReturnsDownloadByteCountClass;
}

export interface FiledReturnsDownloadDiagnostic {
  schemaVersion: "1.0";
  eventType: "filed-return-download-path";
  actionId: string;
  returnType: FiledReturnsReturnType;
  financialYear: string;
  period: string;
  endpointClass: FiledReturnsDownloadEndpointClass;
  artifactType: FiledReturnsConcreteArtifactType;
  downloadPathClass: FiledReturnsDownloadPathClass;
  downloadId?: number;
  status: PortalFlowStepResult["state"];
  mimeClass?: FiledReturnsDownloadMimeClass;
  byteCountClass?: FiledReturnsDownloadByteCountClass;
  errorCategory?: string;
}

export type FiledReturnsFullFiscalYearTargetStatus =
  | "pending"
  | "running"
  | "downloaded"
  | "manually-observed"
  | "not-filed"
  | "download-unconfirmed"
  | "blocked"
  | "failed"
  | "cancelled";

export interface FiledReturnsFullFiscalYearTarget {
  targetId: string;
  financialYear: string;
  period: string;
  returnType: FiledReturnsReturnType;
  artifactType?: FiledReturnsArtifactType;
  status: FiledReturnsFullFiscalYearTargetStatus;
  attempts: number;
  safeSignals: string[];
  safeMessage: string;
  downloadDiagnostic?: FiledReturnsDownloadDiagnostic;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface FiledReturnsFullFiscalYearLedger {
  schemaVersion: "1.0";
  planVersion?: string;
  connectorVersion?: string;
  createdWithExtensionVersion?: string;
  ledgerId: string;
  revision?: number;
  status: "running" | "complete" | "partial" | "blocked" | "cancelled";
  scope: FiledReturnsDownloadScope;
  currentTargetId?: string;
  createdAt: string;
  updatedAt: string;
  eligibleThrough?: string;
  lastReconciledAt?: string;
  targets: FiledReturnsFullFiscalYearTarget[];
}

export interface FiledReturnsFlowSummary {
  scope: FiledReturnsDownloadScope;
  status: "complete" | "running" | "partial" | "blocked" | "cancelled";
  completedAt?: string;
  updatedAt?: string;
  completedPeriods: string[];
  totalPeriods?: number;
  currentPeriod?: string;
  fullFiscalYearRecovery?: {
    ledgerId: string;
    targetId: string;
    expectedRevision: number;
    targetStatus: FiledReturnsFullFiscalYearTargetStatus;
  };
  flowStep: PortalFlowStepResult;
}

export interface PortalFlowStepResult {
  connectorId: ConnectorId;
  scopeId: string;
  state:
    | "clicked"
    | "downloaded"
    | "download-unconfirmed"
    | "ready"
    | "login-required"
    | "user-action-required"
    | "candidate-not-found"
    | "unsupported-page"
    | "blocked";
  safeSignals: string[];
  safeMessage: string;
  userAction?: UserActionRequired;
  downloadDiagnostic?: FiledReturnsDownloadDiagnostic;
}

export interface ArchiveManifestDocument {
  target_id: string;
  document_type: string;
  financial_year?: string;
  period?: string;
  source_kind: SourceKind;
  status: TerminalStatus;
  artifact?: FileEvidence;
  portal_metadata?: AllowListedPortalMetadata;
  error?: DownloadError;
  started_at?: string;
  completed_at: string;
}

export interface ArchiveManifestException {
  target_id: string;
  status: TerminalStatus;
  safe_message: string;
  retryable: boolean;
}

export interface ArchiveManifest {
  schema_version: "1.0";
  manifest_id: string;
  created_at: string;
  product: {
    name: "ComplyEaze Pack";
    version: string;
    build: string;
    official_url: string;
  };
  connector: {
    id: ConnectorId;
    version: string;
    compatibility_version: string;
    portal_label: string;
  };
  execution: {
    mode: ExecutionMode;
    job_id: string;
    started_at: string;
    completed_at: string;
    completion_state: "complete" | "partial" | "cancelled" | "failed";
    browser_family?: string;
    browser_major?: string;
  };
  subject: {
    identifier_type?: string;
    value?: string;
    display_label?: string;
    privacy_classification: "personal-or-business" | "not-collected";
  };
  scope: DownloadScope;
  documents: ArchiveManifestDocument[];
  exceptions: ArchiveManifestException[];
  summary: Record<TerminalStatus | "total_planned" | "failed", number> & {
    manifest_integrity_state: "not-computed";
  };
  privacy: {
    local_only: true;
    contains_sensitive_tax_data: boolean;
    credentials_collected: false;
    cookies_collected: false;
    uploaded_to_complyeaze: false;
  };
}
