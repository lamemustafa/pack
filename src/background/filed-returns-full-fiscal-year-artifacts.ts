import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearTarget,
  PortalFlowStepResult,
} from "../core/contracts";
import { concreteFiledReturnsArtifactTypes } from "../core/filed-returns-artifacts";

const FULL_YEAR_STAGED_SIGNAL_PREFIX = "full-fiscal-year-opfs-staged:";

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
  const artifactSignals = previousSignals.filter(
    (signal) =>
      /^filed-return-artifact-(?:downloaded|unavailable):(?:PDF|EXCEL)$/.test(signal) ||
      /^full-fiscal-year-opfs-staged:(?:PDF|EXCEL)$/.test(signal),
  );
  if (artifactSignals.length === 0) return flowStep;
  return {
    ...flowStep,
    safeSignals: Array.from(new Set([...artifactSignals, ...flowStep.safeSignals])),
  };
}

export function requireFullFiscalYearArtifactsStaged(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
): PortalFlowStepResult {
  if (flowStep.state !== "downloaded") return flowStep;
  const signals = new Set(flowStep.safeSignals);
  const missingArtifactTypes = concreteFiledReturnsArtifactTypes(scope.artifactType).filter(
    (artifactType) =>
      !signals.has(`${FULL_YEAR_STAGED_SIGNAL_PREFIX}${artifactType}`) &&
      !signals.has(`filed-return-artifact-unavailable:${artifactType}`),
  );
  if (missingArtifactTypes.length === 0) return flowStep;
  return {
    ...flowStep,
    state: "blocked",
    safeSignals: [
      ...flowStep.safeSignals,
      "full-fiscal-year-artifact-staging-incomplete",
      ...missingArtifactTypes.map(
        (artifactType) => `full-fiscal-year-artifact-not-staged:${artifactType}`,
      ),
    ],
    safeMessage:
      "Pack observed the portal download, but could not stage every required file for the fiscal-year zip.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Retry this period so Pack can stage the file for the fiscal-year zip.",
      canResume: true,
    },
  };
}

function remainingArtifactTypeForTarget(
  target: FiledReturnsFullFiscalYearTarget,
): FiledReturnsDownloadScope["artifactType"] | undefined {
  if (target.artifactType !== "PDF_AND_EXCEL") return target.artifactType;
  const signals = new Set(target.safeSignals);
  const pdfDone =
    signals.has(`${FULL_YEAR_STAGED_SIGNAL_PREFIX}PDF`) ||
    signals.has("filed-return-artifact-unavailable:PDF");
  const excelDone =
    signals.has(`${FULL_YEAR_STAGED_SIGNAL_PREFIX}EXCEL`) ||
    signals.has("filed-return-artifact-unavailable:EXCEL");
  if (pdfDone && !excelDone) return "EXCEL";
  if (excelDone && !pdfDone) return "PDF";
  return target.artifactType;
}
