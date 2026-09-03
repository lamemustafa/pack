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

/**
 * A root plan that covers every currently supported, full-fiscal-year return.
 *
 * This is deliberately not a `FiledReturnsDownloadScope`: a scope authorises
 * exactly one return type, while this root is expanded into immutable atomic
 * targets when the run is created.
 */
export const FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND =
  "all-supported-returns-full-fiscal-year" as const;

export interface FiledReturnsAllSupportedFullFiscalYearIdentity {
  kind: typeof FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND;
  financialYear: string;
}

/** The user-authorised request shape for an all-supported-returns year run. */
export type FiledReturnsAllSupportedFullFiscalYearRequest =
  FiledReturnsAllSupportedFullFiscalYearIdentity;

/**
 * Readers must distinguish an all-supported-returns run from the existing
 * one-return full-fiscal-year scope. A period alone is not enough identity for
 * the former because the same period occurs under multiple return types.
 */
export type FiledReturnsFullFiscalYearSummaryIdentity =
  | { kind: "single-return"; scope: FiledReturnsDownloadScope }
  | FiledReturnsAllSupportedFullFiscalYearIdentity;

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
      /** SHA-256 of the transient extension Blob URL; the URL itself is never persisted. */
      extensionBlobUrlFingerprint?: string;
    }
  | {
      artifactType: "ZIP";
      downloadId: number;
      kind: "single-period-zip";
      phase: "download-observing";
      requestedAt: string;
      stagingLedgerId: string;
      extensionBlobUrlFingerprint?: string;
    };

export interface FiledReturnsTargetReview {
  /** Exact opaque request identities for a completion that is awaiting review removal. */
  artifactAcquisitionCompletion?: FiledReturnsArtifactAcquisitionCompletion[];
  /** Opaque reference to one malformed session checkpoint being reviewed. */
  artifactAcquisitionMalformedCheckpointReference?: string;
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

export interface FiledReturnsArtifactAcquisitionCompletion {
  artifactType: FiledReturnsConcreteArtifactType;
  /**
   * The exact browser download this artifact was reconciled from. Carried on the
   * marker so a completion interrupted before review removal can be restored
   * with the same evidence it was first proved by, rather than a weaker claim:
   * the checkpoints holding these IDs live in storage.session and do not survive
   * a browser restart or extension update, while the review does.
   */
  downloadId: number;
  requestId: string;
}

export type FiledReturnsDownloadEndpointClass =
  | "gstr3b-portal-rendered-download"
  | "gstr3b-portal-blob-captured-download"
  | "gstr3b-main-world-json-captured-download"
  | "gstr3b-browser-managed-direct-download"
  | "gstr1-pdf-portal-rendered-download"
  | "gstr1-excel-portal-rendered-download"
  | "gstr1-pdf-portal-blob-captured-download"
  | "gstr1-excel-portal-blob-captured-download"
  | "gstr2b-portal-blob-captured-download"
  | "gstr2b-main-world-json-captured-download"
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

/**
 * The target set authorised when a multi-target run was created. This is
 * deliberately separate from mutable target execution state: completion may
 * only compare a run with the exact targets it was asked to acquire.
 */
export interface FiledReturnsLedgerPlanTarget {
  targetId: string;
  financialYear: string;
  period: string;
  returnType: FiledReturnsReturnType;
  artifactType?: FiledReturnsArtifactType;
}

/**
 * The terminal cleanup phases. One predicate rather than a comparison repeated
 * at each call site: splitting `cleaned` by origin turned every existing
 * `=== "cleaned"` into a check that silently stopped matching three quarters of
 * the runs it used to.
 */
export const CLEANED_ZIP_PHASES = [
  "cleaned",
  "cleaned-after-download",
  "cleaned-without-export",
  "cleaned-legacy",
] as const;

export function isCleanedZipPhase(
  phase: FiledReturnsFullFiscalYearLedger["zipPhase"],
): phase is (typeof CLEANED_ZIP_PHASES)[number] {
  return CLEANED_ZIP_PHASES.includes(phase as (typeof CLEANED_ZIP_PHASES)[number]);
}

/** Whether cleanup followed a ZIP the browser confirmed it received. */
export function zipPhaseProvesDelivery(
  phase: FiledReturnsFullFiscalYearLedger["zipPhase"],
): boolean {
  return phase === "cleaned-after-download";
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
    // Cleanup preserves which of the three pending phases it came from, because
    // that origin is the only durable evidence of whether the ZIP reached the
    // browser. Collapsing them into one `cleaned` made a confirmed delivery, a
    // run that produced no ZIP, and a legacy staging cleared on upgrade
    // indistinguishable afterwards -- and an evidence claim built on the
    // collapsed value called never-exported files saved.
    | "cleaned-after-download"
    | "cleaned-without-export"
    | "cleaned-legacy"
    // Retained so a ledger written before the split still parses. It carries no
    // origin, so it stays indeterminate: such a run reads as captured rather
    // than saved, which is the safe direction and the behaviour it already had.
    | "cleaned";
  zipDownloadAttempt?: {
    requestedAt: string;
    downloadId?: number;
  };
  scope: FiledReturnsDownloadScope;
  currentTargetId?: string;
  /** The one GST tab selected before this plan first performed portal work. */
  portalTabId?: number;
  /** Opaque browser-session marker paired with `portalTabId`; never portal data. */
  portalTabSessionId?: string;
  createdAt: string;
  updatedAt: string;
  eligibleThrough?: string;
  lastReconciledAt?: string;
  targetPlan?: FiledReturnsLedgerPlanTarget[];
  targets: FiledReturnsFullFiscalYearTarget[];
}

/**
 * What Pack can prove about one period, in the terms a reader needs.
 *
 * Deliberately a smaller vocabulary than the nine internal target statuses. A
 * reader is deciding one thing -- is this period settled, or does it need me --
 * and nine words to express four answers invites the reader to guess which ones
 * are the same.
 *
 * `saved` is the only value that asserts a file reached the browser. In a
 * full-year run a `downloaded` target means the period's artifacts were staged
 * in OPFS -- the browser handoff happens later, once, for the whole ZIP. So
 * `downloaded` reads as `captured` until that delivery is confirmed and `saved`
 * after it. Calling a staged period saved asserts a delivery from a state that
 * has not reached the browser at all, which is the overclaim this list exists
 * to prevent.
 *
 * `not-filed` is a true outcome but not a saved file, and `manually-observed`
 * is a person's report rather than evidence, which is why it lands in
 * `needs-review` beside the failures.
 */
export type FiledReturnsTargetOutcome =
  | "saved"
  // Some of the selection arrived and some did not. A multi-artifact target
  // reaches `downloaded` when one artifact staged and another was explicitly
  // unavailable, because an unavailable artifact is a resolved outcome -- so
  // `saved` claimed the whole selection for a period that only had part of it.
  //
  // Distinct from `needs-review` on purpose: an artifact the portal never
  // offered is not a fault a re-run corrects, and routing it to review would
  // send someone looking for a problem that is not theirs.
  | "partly-saved"
  | "captured"
  | "not-filed"
  | "needs-review"
  | "running"
  | "pending";

export interface FiledReturnsTargetEvidence {
  period: string;
  outcome: FiledReturnsTargetOutcome;
}

/**
 * Evidence for an all-supported-returns run must include the full target
 * identity. A period-only entry would conflate, for example, the same month
 * under two return types and make both progress and completion claims unsafe.
 */
export interface FiledReturnsAllSupportedFullFiscalYearTargetEvidence {
  targetId: string;
  financialYear: string;
  period: FiledReturnsMonth;
  returnType: FiledReturnsReturnType;
  artifactType: FiledReturnsArtifactType;
  outcome: FiledReturnsTargetOutcome;
}

/**
 * The display summary for the separate all-supported-returns full-year plan.
 * It is intentionally separate from `FiledReturnsFlowSummary`: that existing
 * shape is bound to one atomic scope and readers must never infer that its
 * period-only evidence applies across return types.
 */
export interface FiledReturnsAllSupportedFullFiscalYearFlowSummary {
  /**
   * The saved plan this summary can honestly identify.
   *
   * Absent when the root index itself is malformed: no parsed record can
   * safely name a fiscal year or authorise a plan action in that state.
   */
  summaryIdentity?: FiledReturnsAllSupportedFullFiscalYearIdentity;
  /**
   * The ledger this summary was projected from. A destructive action names it
   * so the background can refuse when the indexed ledger for the root has been
   * replaced since the reader saw it: the fiscal year alone identifies the
   * root, not the plan the reader actually authorised discarding.
   */
  ledgerId?: string;
  /**
   * The exact reviewed target that may be retried after an explicit reader
   * action. It carries the ledger revision so a stale panel cannot replay a
   * target in a newer saved plan.
   */
  allSupportedFullFiscalYearRecovery?: {
    targetId: string;
    expectedRevision: number;
    targetStatus: FiledReturnsFullFiscalYearTargetStatus;
  };
  status: "complete" | "running" | "partial" | "blocked" | "cancelled";
  completedAt?: string;
  updatedAt?: string;
  /** Progress-only target IDs; the durable projection deliberately drops them. */
  completedTargetIds: string[];
  targetEvidence: FiledReturnsAllSupportedFullFiscalYearTargetEvidence[];
  totalTargets: number;
  currentTargetId?: string;
  /**
   * The atomic target scope to which the current flow step is bound.
   *
   * Absent only when the summary is not projected from a plan at all -- a saved
   * plan Pack cannot verify has no target, and inventing one would assert a
   * return type nothing in storage supports.
   */
  flowStepScope?: FiledReturnsDownloadScope;
  flowStep: PortalFlowStepResult;
  /**
   * Whether re-invoking this same all-supported start resumes the saved plan rather than beginning
   * a new one. The runner saves `export-retry-pending` and `downloaded-cleanup-pending` precisely so
   * that phase can be retried; a surface that blocks every non-terminal run hides the only route to
   * those branches and leaves discarding the plan as the sole option.
   */
  resumeAvailable: boolean;
  /** Whether the productive saved-plan branch is ZIP/export/cleanup-only. */
  resumeMode?: "local-only" | "portal";
  /** Every retained terminal root, so no recipe silently targets old completion. */
  terminalPlanRoots?: readonly {
    financialYear: string;
    status: "complete" | "cancelled";
    periodCount: number;
    /**
     * The ledger this root projects. Every retained root can render its own
     * restart control, and each must name the plan the reader reviewed --
     * binding only the currently projected summary leaves the others able to
     * discard whichever ledger is indexed for that year at click time.
     */
    ledgerId?: string;
  }[];
}

/**
 * The session-safe projection validates display evidence before dropping it.
 * Target outcomes can include whether a return was filed, which remains in the
 * ledger that needs it for recovery and must not be copied into session state.
 */
export type FiledReturnsAllSupportedFullFiscalYearDurableSummary = Omit<
  FiledReturnsAllSupportedFullFiscalYearFlowSummary,
  "completedTargetIds" | "targetEvidence"
>;

export interface FiledReturnsFlowSummary {
  /** Binds an artifact-reconciled completion to the acquisition that produced it. */
  artifactAcquisitionCompletion?: FiledReturnsArtifactAcquisitionCompletion[];
  scope: FiledReturnsDownloadScope;
  status: "complete" | "running" | "partial" | "blocked" | "cancelled";
  completedAt?: string;
  updatedAt?: string;
  completedPeriods: string[];
  /**
   * One entry per planned period, in plan order. Present for a full-year run.
   *
   * `completedPeriods` cannot carry this: it counts `downloaded` and `not-filed`
   * together, so a period the taxpayer never filed reads as a saved file. That
   * is right for progress and wrong for evidence, and an aggregate built on it
   * cannot express a partially-settled run at all.
   */
  targetEvidence?: FiledReturnsTargetEvidence[];
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
    | "partial"
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
