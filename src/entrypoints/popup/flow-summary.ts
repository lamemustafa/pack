import type { FiledReturnsDownloadScope, FiledReturnsFlowSummary } from "../../core/contracts";

export function getFiledReturnsCompletionStatus(
  scope: FiledReturnsDownloadScope,
  summary: FiledReturnsFlowSummary | null,
): string | null {
  if (!summary) return null;
  if (!isSameScope(scope, summary.scope)) return null;

  const periodCount = summary.completedPeriods.length;
  const totalPeriods = summary.totalPeriods ?? periodCount;
  if (summary.status === "complete") {
    return `FY ${summary.scope.financialYear} ${summary.scope.returnType} complete. ${periodCount} of ${totalPeriods} ${periodCount === 1 ? "period" : "periods"} reconciled.`;
  }
  if (summary.status === "blocked" && summary.currentPeriod) {
    return `FY ${summary.scope.financialYear} ${summary.scope.returnType} blocked at ${summary.currentPeriod}. ${periodCount} of ${totalPeriods} periods reconciled.`;
  }
  if (summary.status === "running" && summary.currentPeriod) {
    return `FY ${summary.scope.financialYear} ${summary.scope.returnType} running: ${summary.currentPeriod}. ${periodCount} of ${totalPeriods} periods reconciled.`;
  }
  if (summary.status === "partial") {
    return `FY ${summary.scope.financialYear} ${summary.scope.returnType} partial. ${periodCount} of ${totalPeriods} periods reconciled.`;
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

function isSameScope(left: FiledReturnsDownloadScope, right: FiledReturnsDownloadScope): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType
  );
}
