import type { FiledReturnsDownloadScope, FiledReturnsFlowSummary } from "../../core/contracts";

export function getFiledReturnsCompletionStatus(
  scope: FiledReturnsDownloadScope,
  summary: FiledReturnsFlowSummary | null,
): string | null {
  if (!summary) return null;
  if (summary.status !== "complete") return null;
  if (!isSameScope(scope, summary.scope)) return null;
  if (!summary.flowStep.safeSignals.includes("filed-return-financial-year-complete")) return null;

  const periodCount = summary.completedPeriods.length;
  return `FY ${summary.scope.financialYear} ${summary.scope.returnType} download complete. ${periodCount} ${periodCount === 1 ? "period" : "periods"} finished.`;
}

function isSameScope(left: FiledReturnsDownloadScope, right: FiledReturnsDownloadScope): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType
  );
}
