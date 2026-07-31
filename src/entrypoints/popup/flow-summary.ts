import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
} from "../../connectors/gst/filed-returns-contracts";
import { normaliseFiledReturnsArtifactType } from "../../connectors/gst/filed-returns-artifacts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../connectors/gst/filed-returns-scope";

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

export function getFiledReturnsCompletionStatus(
  scope: FiledReturnsDownloadScope,
  summary: FiledReturnsFlowSummary | null,
): string | null {
  const matchedSummary = getScopeMatchedFiledReturnsSummary(scope, summary);
  if (!matchedSummary) return null;

  const periodCount = matchedSummary.completedPeriods.length;
  const totalPeriods = matchedSummary.totalPeriods ?? periodCount;
  if (
    matchedSummary.flowStep.state === "download-unconfirmed" &&
    matchedSummary.flowStep.safeSignals.includes("full-fiscal-year-zip-download-unconfirmed")
  ) {
    return hasPersistedFullFiscalYearZipDownloadId(matchedSummary)
      ? `FY ${matchedSummary.scope.financialYear} ${matchedSummary.scope.returnType} prepared. ${periodCount} of ${totalPeriods} periods reconciled; check the saved final ZIP status.`
      : `FY ${matchedSummary.scope.financialYear} ${matchedSummary.scope.returnType} prepared. ${periodCount} of ${totalPeriods} periods reconciled; check Browser Downloads before retrying the final ZIP.`;
  }
  if (matchedSummary.status === "complete") {
    return `FY ${matchedSummary.scope.financialYear} ${matchedSummary.scope.returnType} complete. ${periodCount} of ${totalPeriods} ${periodCount === 1 ? "period" : "periods"} reconciled.`;
  }
  if (matchedSummary.status === "blocked" && matchedSummary.currentPeriod) {
    return `FY ${matchedSummary.scope.financialYear} ${matchedSummary.scope.returnType} blocked at ${matchedSummary.currentPeriod}. ${periodCount} of ${totalPeriods} periods reconciled.`;
  }
  if (matchedSummary.status === "running" && matchedSummary.currentPeriod) {
    return `FY ${matchedSummary.scope.financialYear} ${matchedSummary.scope.returnType} running: ${matchedSummary.currentPeriod}. ${periodCount} of ${totalPeriods} periods reconciled.`;
  }
  if (matchedSummary.status === "partial") {
    return `FY ${matchedSummary.scope.financialYear} ${matchedSummary.scope.returnType} partial. ${periodCount} of ${totalPeriods} periods reconciled.`;
  }
  if (matchedSummary.status === "cancelled") {
    return `Saved FY ${matchedSummary.scope.financialYear} ${matchedSummary.scope.returnType} run cleared. Start a fresh local run when the GST Portal is ready.`;
  }
  return null;
}

export function getFiledReturnsSummaryHeading(
  scope: FiledReturnsDownloadScope,
  summary: FiledReturnsFlowSummary,
): string | null {
  if (!isSameScope(scope, summary.scope)) return null;
  if (summary.status === "cancelled") return "Ready for a new filed-returns run";
  return `Last filed-returns run: ${summary.status}`;
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
