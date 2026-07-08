import type { FiledReturnsDownloadScope, FiledReturnsFlowSummary } from "../../core/contracts";
import { normaliseFiledReturnsArtifactType } from "../../core/filed-returns-artifacts";

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
    return `FY ${matchedSummary.scope.financialYear} ${matchedSummary.scope.returnType} prepared. ${periodCount} of ${totalPeriods} periods reconciled; confirm the final ZIP save.`;
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
