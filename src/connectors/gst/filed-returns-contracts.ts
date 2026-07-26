import type { ConnectorId, UserActionRequired } from "../../core/contracts";
import type {
  FiledReturnsArtifactType,
  FiledReturnsConcreteArtifactType,
} from "./filed-returns-artifacts";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";
import type { FiledReturnsMonth } from "./filed-returns-scope";

export interface FiledReturnsDownloadScope {
  financialYear: string;
  period: string;
  returnType: FiledReturnsReturnType;
  artifactType?: FiledReturnsArtifactType;
  completedPeriods?: string[];
}

export interface FiledReturnsDownloadTarget {
  actionId: string;
  financialYear: string;
  period: string;
  returnType: FiledReturnsReturnType;
  artifactType?: FiledReturnsConcreteArtifactType;
}

export interface FiledReturnsCapturedDownloadRequest {
  actionId: string;
  dataUrl: string;
  safeSignals: string[];
}

export interface FiledReturnsMainWorldCaptureRequest {
  actionId: string;
  /** Narrow async handoff allowed only for the verified action's qualifying XHR. */
  asyncBlobBinding?: "action-xhr-non-artifact-to-pdf";
  controlAttribute: string;
  controlId: string;
  maxBytes: number;
  signalPrefix: string;
  /** Transient Pack-only filename binding for the single-period GSTR-3B native fallback. */
  targetBoundNativeFilenameNonce?: string;
  /** Target snapshot required in both the background and MAIN worlds before any portal click. */
  targetBinding: {
    artifactType: FiledReturnsConcreteArtifactType;
    controlTextDigest: string;
    financialYear: string;
    pathnameDigest: string;
    period: FiledReturnsMonth;
    returnType: FiledReturnsReturnType;
  };
  timeoutMs?: number;
}

export type FiledReturnsTargetDownloadAttempt =
  | {
      artifactType: FiledReturnsConcreteArtifactType;
      actionId: string;
      /** A single fixed browser request rather than a portal control click. */
      directDownload?: true;
      kind: "single-artifact";
      phase: "download-intent-persisted";
      requestedAt: string;
    }
  | {
      artifactType: FiledReturnsConcreteArtifactType;
      actionId: string;
      directDownload?: true;
      downloadId: number;
      kind: "single-artifact";
      phase: "target-bound-candidate-observing";
      requestedAt: string;
      candidateWindowEndsAt: string;
    }
  | {
      artifactType: FiledReturnsConcreteArtifactType;
      actionId: string;
      directDownload?: true;
      downloadId: number;
      kind: "single-artifact";
      phase: "download-observing";
      requestedAt: string;
    }
  | {
      artifactType: "ZIP";
      kind: "single-period-zip";
      phase: "download-intent-persisted";
      requestedAt: string;
      stagingLedgerId: string;
    }
  | {
      artifactType: "ZIP";
      downloadId: number;
      kind: "single-period-zip";
      phase: "download-observing";
      requestedAt: string;
      stagingLedgerId: string;
    };

export interface FiledReturnsTargetReview {
  downloadAttempt?: FiledReturnsTargetDownloadAttempt;
  downloadDiagnostic?: FiledReturnsDownloadDiagnostic;
  downloadDiagnostics?: FiledReturnsDownloadDiagnostic[];
  /** Local-only checkpoint binding an interrupted selected-file review to one exact bundle. */
  singlePeriodBundleCheckpoint?: {
    ledgerId: string;
    revision: number;
  };
  /** Legacy reviews without a revision are normalised to revision 1 on read. */
  revision?: number;
  schemaVersion: "1.0";
  targetId: string;
  status: "download-unconfirmed";
  scope: FiledReturnsDownloadScope;
  safeSignals: string[];
  safeMessage: string;
  updatedAt: string;
}

export type FiledReturnsDownloadEndpointClass =
  | "gstr3b-portal-rendered-download"
  | "gstr3b-portal-blob-captured-download"
  | "gstr3b-browser-managed-direct-download"
  | "gstr1-pdf-portal-rendered-download"
  | "gstr1-excel-portal-rendered-download"
  | "gstr1-pdf-portal-blob-captured-download"
  | "gstr1-excel-portal-blob-captured-download"
  | "gstr2b-portal-blob-captured-download"
  | "filed-return-portal-rendered-download"
  | "unknown";

export type FiledReturnsDownloadPathClass =
  | "portal-click-https"
  | "portal-click-blob"
  | "portal-click-data"
  | "portal-click-unknown"
  | "target-bound-portal-click-blob"
  | "captured-portal-request-https"
  | "captured-portal-request-blob"
  | "captured-portal-request-data"
  | "captured-portal-request-unknown"
  | "extension-direct-https"
  | "extension-direct-unknown";

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
  downloadDiagnostics?: FiledReturnsDownloadDiagnostic[];
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
  zipPhase?:
    | "export-pending"
    | "export-retry-pending"
    | "download-intent-persisted"
    | "download-observing"
    | "download-started"
    | "restaging-required"
    | "downloaded-cleanup-pending"
    | "no-artifacts-cleanup-pending"
    | "legacy-cleanup-pending"
    | "cleaned";
  zipDownloadAttempt?: {
    requestedAt: string;
    downloadId?: number;
  };
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
  downloadDiagnostics?: FiledReturnsDownloadDiagnostic[];
}
