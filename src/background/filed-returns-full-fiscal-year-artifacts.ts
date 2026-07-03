import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearTarget,
  PortalFlowStepResult,
} from "../core/contracts";

export function scopeForFullFiscalYearTarget(
  target: FiledReturnsFullFiscalYearTarget,
): FiledReturnsDownloadScope {
  const remainingArtifactType = remainingArtifactTypeForTarget(target);
  return {
    financialYear: target.financialYear,
    period: target.period,
    returnType: target.returnType,
    ...(remainingArtifactType ? { artifactType: remainingArtifactType } : {}),
  };
}

export function mergeRetriedArtifactSignals(
  previousSignals: readonly string[],
  flowStep: PortalFlowStepResult,
): PortalFlowStepResult {
  const artifactSignals = previousSignals.filter((signal) =>
    /^filed-return-artifact-(?:downloaded|unavailable):(?:PDF|EXCEL)$/.test(signal),
  );
  if (artifactSignals.length === 0) return flowStep;
  return {
    ...flowStep,
    safeSignals: Array.from(new Set([...artifactSignals, ...flowStep.safeSignals])),
  };
}

function remainingArtifactTypeForTarget(
  target: FiledReturnsFullFiscalYearTarget,
): FiledReturnsDownloadScope["artifactType"] | undefined {
  if (target.artifactType !== "PDF_AND_EXCEL") return target.artifactType;
  const signals = new Set(target.safeSignals);
  const pdfDone =
    signals.has("filed-return-artifact-downloaded:PDF") ||
    signals.has("filed-return-artifact-unavailable:PDF");
  const excelDone =
    signals.has("filed-return-artifact-downloaded:EXCEL") ||
    signals.has("filed-return-artifact-unavailable:EXCEL");
  if (pdfDone && !excelDone) return "EXCEL";
  if (excelDone && !pdfDone) return "PDF";
  return target.artifactType;
}
