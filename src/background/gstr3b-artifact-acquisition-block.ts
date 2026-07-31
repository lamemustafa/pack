import type {
  FiledReturnsDownloadScope,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import { FULL_FISCAL_YEAR_PERIOD } from "../connectors/gst/filed-returns-scope";

export enum Gstr3bArtifactAcquisitionBlockReason {
  FullFiscalYearNotWired = "gstr3b-full-fiscal-year-acquisition-not-wired",
}

export function isGstr3bFullFiscalYearAcquisitionScope(scope: FiledReturnsDownloadScope): boolean {
  return (
    scope.returnType === "GSTR-3B" &&
    (scope.period === "ALL" || scope.period === FULL_FISCAL_YEAR_PERIOD)
  );
}

export function gstr3bFullFiscalYearAcquisitionNotWiredStep(): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId("GSTR-3B"),
    state: "blocked",
    safeSignals: [Gstr3bArtifactAcquisitionBlockReason.FullFiscalYearNotWired],
    safeMessage:
      "Pack does not yet acquire full-fiscal-year GSTR-3B artifacts through the verified artifact path.",
  };
}
