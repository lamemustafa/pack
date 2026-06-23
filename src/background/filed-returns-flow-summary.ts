import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../core/contracts";

export async function persistFiledReturnsCompletionSummary(
  completionKey: string,
  scope: FiledReturnsDownloadScope,
  completedPeriods: ReadonlySet<string>,
  flowStep: PortalFlowStepResult,
): Promise<FiledReturnsFlowSummary> {
  const summary: FiledReturnsFlowSummary = {
    completedAt: new Date().toISOString(),
    completedPeriods: [...completedPeriods],
    flowStep,
    scope: {
      financialYear: scope.financialYear,
      period: scope.period,
      returnType: scope.returnType,
    },
    status: "complete",
  };
  await browser.storage.session.set({ [completionKey]: summary });
  return summary;
}
