import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import {
  normaliseFiledReturnsArtifactType,
  type FiledReturnsConcreteArtifactType,
} from "../core/filed-returns-artifacts";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";

export function createSinglePeriodBundleLedgerId(scope: FiledReturnsDownloadScope): string {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return ["single-period", scope.returnType, scope.financialYear, scope.period, suffix]
    .join(":")
    .replace(/[^a-zA-Z0-9:._-]/g, "_");
}

export function toOptionalArtifactUnavailableFlowStep({
  artifactType,
  artifactTypes,
  combinedFlowStep,
  nextFlowStep,
  scope,
}: {
  artifactType: FiledReturnsConcreteArtifactType;
  artifactTypes: readonly FiledReturnsConcreteArtifactType[];
  combinedFlowStep: PortalFlowStepResult | null;
  nextFlowStep: PortalFlowStepResult;
  scope: FiledReturnsDownloadScope;
}): PortalFlowStepResult | null {
  if (
    scope.returnType !== "GSTR-1" ||
    artifactTypes.length === 1 ||
    artifactType !== "EXCEL" ||
    !combinedFlowStep ||
    !nextFlowStep.safeSignals.includes("filed-gstr1-excel-no-details-available")
  ) {
    return null;
  }

  const flowStep = combineDownloadedArtifactFlowSteps(combinedFlowStep, nextFlowStep);
  return {
    ...flowStep,
    state: "downloaded",
    safeSignals: Array.from(
      new Set([...flowStep.safeSignals, "filed-return-artifact-unavailable:EXCEL"]),
    ),
    safeMessage:
      "Pack downloaded the filed GSTR-1 summary PDF. The GST Portal reported that no e-invoice details Excel is available for this period.",
  };
}

export function selectedArtifactsSafeMessage(flowStep: PortalFlowStepResult): string {
  if (flowStep.safeSignals.includes("filed-return-artifact-unavailable:EXCEL")) {
    return "Pack downloaded the filed GSTR-1 summary PDF. The GST Portal reported that no e-invoice details Excel is available for this period.";
  }
  return "Pack downloaded the selected filed-return artifacts.";
}

export async function readPersistedArtifactProgress(
  scope: FiledReturnsDownloadScope,
  artifactTypes: readonly FiledReturnsConcreteArtifactType[],
  deps: FiledReturnsFlowRunnerDeps,
): Promise<{
  completedArtifactTypes: FiledReturnsConcreteArtifactType[];
  flowStep: PortalFlowStepResult;
} | null> {
  const values = (await browser.storage.session
    .get(deps.storageKeys.completion)
    .catch(() => ({}))) as Record<string, unknown>;
  const summary = parsePersistedPartialSummary(values[deps.storageKeys.completion]);
  if (!summary || summary.status !== "partial") return null;
  if (!sameFiledReturnsScope(summary.scope, scope)) return null;

  const completedArtifactTypes = downloadedArtifactTypes(summary.flowStep.safeSignals).filter(
    (artifactType) => artifactTypes.includes(artifactType),
  );
  if (completedArtifactTypes.length === 0) return null;
  return { completedArtifactTypes, flowStep: summary.flowStep };
}

export async function persistPartialArtifactSummary(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<FiledReturnsFlowSummary> {
  const summary: FiledReturnsFlowSummary = {
    scope,
    status: "partial",
    updatedAt: (deps.now?.() ?? new Date()).toISOString(),
    completedPeriods: [],
    currentPeriod: scope.period,
    flowStep,
    totalPeriods: 1,
  };
  await browser.storage.session.set({ [deps.storageKeys.completion]: summary });
  return summary;
}

export function markArtifactProgressNeedsReview(
  flowStep: PortalFlowStepResult,
  response: Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }>,
): PortalFlowStepResult {
  if (
    !response.flowSummary?.flowStep.safeSignals.includes("filed-returns-target-review-required") ||
    flowStep.safeSignals.includes("filed-returns-target-review-required")
  ) {
    return flowStep;
  }
  return {
    ...flowStep,
    safeSignals: [...flowStep.safeSignals, "filed-returns-target-review-required"],
  };
}

export function combineDownloadedArtifactFlowSteps(
  combinedFlowStep: PortalFlowStepResult | null,
  nextFlowStep: PortalFlowStepResult,
): PortalFlowStepResult {
  if (!combinedFlowStep) return nextFlowStep;
  return {
    ...nextFlowStep,
    safeSignals: Array.from(
      new Set([...combinedFlowStep.safeSignals, ...nextFlowStep.safeSignals]),
    ),
  };
}

function parsePersistedPartialSummary(input: unknown): FiledReturnsFlowSummary | null {
  if (!input || typeof input !== "object") return null;
  const summary = input as Partial<FiledReturnsFlowSummary>;
  if (summary.status !== "partial") return null;
  if (!summary.scope || typeof summary.scope !== "object") return null;
  if (!summary.flowStep || typeof summary.flowStep !== "object") return null;
  if (!Array.isArray(summary.flowStep.safeSignals)) return null;
  if (typeof summary.flowStep.state !== "string") return null;
  return summary as FiledReturnsFlowSummary;
}

function downloadedArtifactTypes(
  safeSignals: readonly string[],
): FiledReturnsConcreteArtifactType[] {
  const completedArtifactTypes = safeSignals
    .map((signal) => signal.match(/^filed-return-artifact-downloaded:(PDF|EXCEL)$/)?.[1])
    .filter(
      (artifactType): artifactType is FiledReturnsConcreteArtifactType =>
        artifactType === "PDF" || artifactType === "EXCEL",
    );
  return Array.from(new Set(completedArtifactTypes));
}

function sameFiledReturnsScope(
  left: FiledReturnsDownloadScope,
  right: FiledReturnsDownloadScope,
): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType &&
    normaliseFiledReturnsArtifactType(left.returnType, left.artifactType) ===
      normaliseFiledReturnsArtifactType(right.returnType, right.artifactType)
  );
}
