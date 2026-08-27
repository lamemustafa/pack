import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
} from "../../connectors/gst/filed-returns-contracts";
import {
  concreteFiledReturnsArtifactTypesForSelection,
  normaliseFiledReturnsArtifactType,
} from "../../connectors/gst/filed-returns-artifacts";
import { FILED_RETURNS_FILENAME_OVERRIDDEN_SIGNALS } from "../../connectors/gst/filed-returns-durable-signals";
import { FULL_FISCAL_YEAR_PERIOD } from "../../connectors/gst/filed-returns-scope";
import { canReconcileFiledReturnsTarget } from "./run-summary";

export function hasUnresolvedFiledReturnsTargetReview(
  summary: FiledReturnsFlowSummary | null,
): boolean {
  return Boolean(
    summary?.status === "blocked" &&
    summary.flowStep.safeSignals.includes("filed-returns-target-review-required"),
  );
}

export function hasUnresolvedFiledReturnsRecovery(
  summary: FiledReturnsFlowSummary | null,
): boolean {
  return Boolean(hasUnresolvedFiledReturnsTargetReview(summary) || summary?.fullFiscalYearRecovery);
}

export function canRetryFullFiscalYearZipWithoutPortal(
  summary: FiledReturnsFlowSummary | null | undefined,
): boolean {
  if (
    !summary ||
    summary.scope.period !== FULL_FISCAL_YEAR_PERIOD ||
    summary.status !== "blocked"
  ) {
    return false;
  }
  const signals = new Set(summary.flowStep.safeSignals);
  if (!signals.has("full-fiscal-year-opfs-retained")) return false;
  return (
    signals.has("full-fiscal-year-final-zip-retry") ||
    signals.has("full-fiscal-year-final-zip-manual-review") ||
    signals.has("full-fiscal-year-local-cleanup-retry") ||
    signals.has("full-fiscal-year-zip-export-pending") ||
    signals.has("full-fiscal-year-zip-phase:download-started") ||
    signals.has("full-fiscal-year-zip-phase:download-intent-persisted") ||
    signals.has("full-fiscal-year-zip-phase:download-observing") ||
    signals.has("full-fiscal-year-zip-phase:export-retry-pending")
  );
}

/** Copy only: the background must still validate the retained run before cleanup. */
export function getFullFiscalYearCleanupCopy(summary: FiledReturnsFlowSummary | null | undefined) {
  if (
    !summary ||
    !canRetryFullFiscalYearZipWithoutPortal(summary) ||
    summary.currentPeriod ||
    hasUnresolvedFiledReturnsRecovery(summary) ||
    isAmbiguousFullFiscalYearZipHandoff(summary) ||
    !summary.flowStep.safeSignals.includes("full-fiscal-year-local-cleanup-retry")
  ) {
    return null;
  }
  return {
    label: "Retry local cleanup",
    summary: "Retry cleanup for this saved run.",
    contextLabel: "Saved run · local cleanup",
    busyLabel: "Checking saved run",
    busySummary: "Pack is checking the saved run before retrying local cleanup.",
  };
}

/**
 * Whether the target-review retry action — reconciling the exact browser download, or
 * retrying local cleanup — can complete without a portal tab. Both paths return locally in
 * `retryFiledReturnsTargetDownloadFlow` (src/background/filed-returns-flow-runner.ts) before
 * any portal action is attempted; only falling through to a fresh single-period download
 * reaches the portal. This is the target-review sibling of
 * `canRetryFullFiscalYearZipWithoutPortal` above — extend this function, not a parallel check,
 * when another retry path turns out to be portal-independent.
 */
export function canRetryFiledReturnsTargetWithoutPortal(
  summary: FiledReturnsFlowSummary | null | undefined,
): boolean {
  if (!summary) return false;
  if (canReconcileFiledReturnsTarget(summary)) return true;
  return summary.flowStep.safeSignals.includes("filed-returns-target-local-cleanup-required");
}

export function isAmbiguousFullFiscalYearZipHandoff(
  summary: FiledReturnsFlowSummary | null | undefined,
): boolean {
  if (!summary || summary.scope.period !== FULL_FISCAL_YEAR_PERIOD) return false;
  const signals = new Set(summary.flowStep.safeSignals);
  return (
    summary.flowStep.state === "download-unconfirmed" &&
    (signals.has("full-fiscal-year-zip-download-unconfirmed") ||
      signals.has("full-fiscal-year-zip-phase:download-started"))
  );
}

export function hasPersistedFullFiscalYearZipDownloadId(
  summary: FiledReturnsFlowSummary | null | undefined,
): boolean {
  return Boolean(
    isAmbiguousFullFiscalYearZipHandoff(summary) &&
    summary?.flowStep.safeSignals.includes("full-fiscal-year-zip-phase:download-observing"),
  );
}

/**
 * A complete single-period run is not itself evidence that the browser saved a file.
 * This is deliberately a presentation predicate: the background retains the stricter
 * target-bound diagnostics it needs for recovery, while these surfaces only decide
 * whether they may describe the browser handoff as confirmed.
 */
export function hasConfirmedSinglePeriodBrowserDownload(
  summary: FiledReturnsFlowSummary | null | undefined,
): boolean {
  if (!summary || summary.scope.period === FULL_FISCAL_YEAR_PERIOD) return false;
  const signals = new Set(summary.flowStep.safeSignals);
  if (
    signals.has("single-period-zip-downloaded") ||
    (signals.has("browser-download-completed") && signals.has("browser-download-non-empty"))
  ) {
    return true;
  }

  const diagnostics = [
    ...(summary.flowStep.downloadDiagnostic ? [summary.flowStep.downloadDiagnostic] : []),
    ...(summary.flowStep.downloadDiagnostics ?? []),
  ];
  return concreteFiledReturnsArtifactTypesForSelection(
    summary.scope.returnType,
    summary.scope.artifactType,
  ).every((artifactType) =>
    diagnostics.some(
      (diagnostic) =>
        diagnostic.actionId.length > 0 &&
        diagnostic.artifactType === artifactType &&
        diagnostic.byteCountClass === "non-empty" &&
        typeof diagnostic.downloadId === "number" &&
        Number.isSafeInteger(diagnostic.downloadId) &&
        diagnostic.downloadId >= 0 &&
        diagnostic.financialYear === summary.scope.financialYear &&
        diagnostic.period === summary.scope.period &&
        diagnostic.returnType === summary.scope.returnType &&
        diagnostic.status === "downloaded",
    ),
  );
}

export function hasFiledReturnsDownloadFilenameOverride(
  summary: FiledReturnsFlowSummary | null | undefined,
): boolean {
  return Boolean(
    summary?.flowStep.safeSignals.some((signal) =>
      FILED_RETURNS_FILENAME_OVERRIDDEN_SIGNALS.includes(
        signal as (typeof FILED_RETURNS_FILENAME_OVERRIDDEN_SIGNALS)[number],
      ),
    ),
  );
}

export function getScopeMatchedFiledReturnsSummary(
  scope: FiledReturnsDownloadScope,
  summary: FiledReturnsFlowSummary | null,
): FiledReturnsFlowSummary | null {
  if (!summary) return null;
  return isSameScope(scope, summary.scope) ? summary : null;
}

function isSameScope(left: FiledReturnsDownloadScope, right: FiledReturnsDownloadScope): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType &&
    normaliseFiledReturnsArtifactType(left.returnType, left.artifactType) ===
      normaliseFiledReturnsArtifactType(right.returnType, right.artifactType)
  );
}
