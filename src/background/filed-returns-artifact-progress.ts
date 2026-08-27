import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import {
  normaliseFiledReturnsArtifactType,
  type FiledReturnsConcreteArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import {
  filedReturnsArtifactProgressFailureReasonFromSignal,
  filedReturnsArtifactProgressFailureSignal,
  type FiledReturnsArtifactProgressFailureReason,
} from "../connectors/gst/filed-returns-artifact-progress-recovery";
import { canonicalDurableTargetStatus } from "../connectors/gst/filed-returns-durable-status";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import { isCanonicalSinglePeriodLedgerId } from "../connectors/gst/filed-returns-ledger-id";
import { PACK_LOCAL_STORAGE_KEYS } from "./storage-keys";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import {
  persistCanonicalFiledReturnsFlowSummary,
  readCanonicalFiledReturnsFlowSummaryStorageState,
} from "./filed-returns-session-summary";
import {
  copyFiledReturnsDownloadDiagnosticState,
  isValidFiledReturnsDownloadDiagnosticState,
  mergeFiledReturnsDownloadDiagnosticState,
} from "./filed-returns-download-diagnostic-state";

interface SinglePeriodStagingRecord {
  ledgerId: string;
  schemaVersion: "1.0";
}

export class InvalidSinglePeriodStagingRecordError extends Error {
  constructor(readonly recoverableLedgerId: string | null) {
    super("Invalid staging record.");
  }
}

export async function readSinglePeriodStagingRecord(): Promise<SinglePeriodStagingRecord | null> {
  const values = await browser.storage.local.get(PACK_LOCAL_STORAGE_KEYS.singlePeriodStaging);
  const record = values[PACK_LOCAL_STORAGE_KEYS.singlePeriodStaging];
  if (record === undefined) return null;
  if (!record || typeof record !== "object") {
    throw new InvalidSinglePeriodStagingRecordError(null);
  }
  const candidate = record as Partial<SinglePeriodStagingRecord>;
  const recoverableLedgerId = recoverableSinglePeriodLedgerId(candidate);
  if (candidate.schemaVersion !== "1.0" || !recoverableLedgerId) {
    throw new InvalidSinglePeriodStagingRecordError(recoverableLedgerId);
  }
  return { ledgerId: recoverableLedgerId, schemaVersion: "1.0" };
}

function recoverableSinglePeriodLedgerId(
  candidate: Partial<SinglePeriodStagingRecord>,
): string | null {
  return isCanonicalSinglePeriodLedgerId(candidate.ledgerId) ? candidate.ledgerId : null;
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

  const flowStep = combineDownloadedArtifactFlowSteps(combinedFlowStep, nextFlowStep, scope);
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

export type PersistedArtifactProgress =
  | {
      reason: FiledReturnsArtifactProgressFailureReason;
      state: "blocked";
    }
  | {
      completedArtifactTypes: FiledReturnsConcreteArtifactType[];
      flowStep: PortalFlowStepResult;
      state: "ready";
    };

export function artifactProgressFailureFlowStep(
  scope: FiledReturnsDownloadScope,
  reason: FiledReturnsArtifactProgressFailureReason,
): PortalFlowStepResult {
  const durableStatus = canonicalDurableTargetStatus(scope, "target-review", [
    filedReturnsArtifactProgressFailureSignal(reason),
  ]);
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(scope.returnType),
    state: "blocked",
    safeSignals: durableStatus.safeSignals,
    safeMessage: durableStatus.safeMessage,
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Use Clear local Pack data only after reviewing the retained selected-file run.",
      canResume: false,
    },
  };
}

export async function readPersistedArtifactProgress(
  scope: FiledReturnsDownloadScope,
  artifactTypes: readonly FiledReturnsConcreteArtifactType[],
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PersistedArtifactProgress | null> {
  const malformedFlowStep = artifactProgressFailureFlowStep(scope, "malformed-summary");
  const storageState = await readCanonicalFiledReturnsFlowSummaryStorageState(
    deps.storageKeys.completion,
    {
      scope,
      status: "blocked",
      updatedAt: (deps.now?.() ?? new Date()).toISOString(),
      completedPeriods: [],
      currentPeriod: scope.period,
      flowStep: malformedFlowStep,
      totalPeriods: 1,
    },
  );
  if (storageState.state === "missing") return null;
  if (storageState.state === "malformed") {
    return { reason: "malformed-summary", state: "blocked" };
  }
  if (storageState.state === "unavailable") {
    return { reason: storageState.reason, state: "blocked" };
  }
  const retainedFailureReason = storageState.summary.flowStep.safeSignals
    .map(filedReturnsArtifactProgressFailureReasonFromSignal)
    .find((reason) => reason !== null);
  if (retainedFailureReason) {
    return { reason: retainedFailureReason, state: "blocked" };
  }
  const summary = storageState.summary;
  const completedArtifactTypes =
    summary.status === "partial" &&
    sameFiledReturnsScope(summary.scope, scope) &&
    isValidFiledReturnsDownloadDiagnosticState(summary.flowStep, summary.scope)
      ? downloadedArtifactTypes(summary.flowStep.safeSignals).filter((artifactType) =>
          artifactTypes.includes(artifactType),
        )
      : completedConcreteArtifactTypeForSelection(summary, scope, artifactTypes);
  if (completedArtifactTypes.length === 0) return null;
  return { completedArtifactTypes, flowStep: summary.flowStep, state: "ready" };
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
  await persistCanonicalFiledReturnsFlowSummary(deps.storageKeys.completion, summary);
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
  scope: FiledReturnsDownloadScope,
): PortalFlowStepResult {
  if (!combinedFlowStep) return nextFlowStep;
  const diagnosticState = mergeFiledReturnsDownloadDiagnosticState(
    combinedFlowStep,
    nextFlowStep,
    scope,
  );
  if (!diagnosticState) {
    const rejectedStep: PortalFlowStepResult = {
      ...nextFlowStep,
      state: "blocked",
      safeSignals: Array.from(
        new Set([
          ...combinedFlowStep.safeSignals,
          ...nextFlowStep.safeSignals,
          "filed-return-download-diagnostics-rejected",
        ]),
      ),
      safeMessage:
        "Pack could not retain privacy-safe, target-bound evidence for every selected artifact.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Review this target before retrying the selected artifacts.",
        canResume: true,
      },
    };
    delete rejectedStep.downloadDiagnostic;
    delete rejectedStep.downloadDiagnostics;
    return {
      ...rejectedStep,
      ...(isValidFiledReturnsDownloadDiagnosticState(combinedFlowStep, scope)
        ? copyFiledReturnsDownloadDiagnosticState(combinedFlowStep)
        : {}),
    };
  }
  return {
    ...nextFlowStep,
    ...diagnosticState,
    safeSignals: Array.from(
      new Set([...combinedFlowStep.safeSignals, ...nextFlowStep.safeSignals]),
    ),
  };
}

function completedConcreteArtifactTypeForSelection(
  summary: FiledReturnsFlowSummary,
  scope: FiledReturnsDownloadScope,
  artifactTypes: readonly FiledReturnsConcreteArtifactType[],
): FiledReturnsConcreteArtifactType[] {
  const artifactType = summary.scope.artifactType;
  if (
    summary.status !== "complete" ||
    summary.flowStep.state !== "downloaded" ||
    !summary.flowStep.safeSignals.includes("artifact-acquisition-download-reconciled") ||
    !summary.artifactAcquisitionCompletion ||
    summary.artifactAcquisitionCompletion.length !== 1 ||
    !artifactType ||
    !artifactTypes.includes(artifactType as FiledReturnsConcreteArtifactType) ||
    summary.scope.financialYear !== scope.financialYear ||
    summary.scope.period !== scope.period ||
    summary.scope.returnType !== scope.returnType
  ) {
    return [];
  }
  const [evidence] = summary.artifactAcquisitionCompletion;
  return evidence?.artifactType === artifactType ? [artifactType] : [];
}

function downloadedArtifactTypes(
  safeSignals: readonly string[],
): FiledReturnsConcreteArtifactType[] {
  const completedArtifactTypes = safeSignals
    .map((signal) => signal.match(/^filed-return-artifact-downloaded:(PDF|JSON|EXCEL)$/)?.[1])
    .filter(
      (artifactType): artifactType is FiledReturnsConcreteArtifactType =>
        artifactType === "PDF" || artifactType === "JSON" || artifactType === "EXCEL",
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
