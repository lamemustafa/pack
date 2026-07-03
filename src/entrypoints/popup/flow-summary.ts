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
  return null;
}

export function getFiledReturnsSummaryHeading(
  scope: FiledReturnsDownloadScope,
  summary: FiledReturnsFlowSummary,
): string | null {
  if (!isSameScope(scope, summary.scope)) return null;
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
