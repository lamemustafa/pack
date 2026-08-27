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
  createFiledReturnsLedgerId,
  isCanonicalSinglePeriodLedgerId,
} from "../connectors/gst/filed-returns-ledger-id";
import { PACK_LOCAL_STORAGE_KEYS } from "./storage-keys";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import {
  persistCanonicalFiledReturnsFlowSummary,
  readCanonicalFiledReturnsFlowSummary,
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

export function createSinglePeriodBundleLedgerId(): string {
  return createFiledReturnsLedgerId("single-period");
}

export async function reserveSinglePeriodBundleLedger(): Promise<string | null> {
  let existing: SinglePeriodStagingRecord | null;
  try {
    existing = await readSinglePeriodStagingRecord();
  } catch {
    return null;
  }
  if (existing) return null;

  const ledgerId = createSinglePeriodBundleLedgerId();
  const record: SinglePeriodStagingRecord = { ledgerId, schemaVersion: "1.0" };
  try {
    await browser.storage.local.set({ [PACK_LOCAL_STORAGE_KEYS.singlePeriodStaging]: record });
    return ledgerId;
  } catch {
    return null;
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

export async function clearSinglePeriodStagingRecord(ledgerId: string): Promise<boolean> {
  let record: SinglePeriodStagingRecord | null;
  try {
    record = await readSinglePeriodStagingRecord();
  } catch {
    return false;
  }
  if (!record) return true;
  if (record.ledgerId !== ledgerId) return false;
  try {
    await browser.storage.local.remove(PACK_LOCAL_STORAGE_KEYS.singlePeriodStaging);
    return true;
  } catch {
    return false;
  }
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

export async function readPersistedArtifactProgress(
  scope: FiledReturnsDownloadScope,
  artifactTypes: readonly FiledReturnsConcreteArtifactType[],
  deps: FiledReturnsFlowRunnerDeps,
): Promise<{
  completedArtifactTypes: FiledReturnsConcreteArtifactType[];
  flowStep: PortalFlowStepResult;
} | null> {
  const summary = await readCanonicalFiledReturnsFlowSummary(deps.storageKeys.completion).catch(
    () => null,
  );
  if (!summary) return null;
  const completedArtifactTypes =
    summary.status === "partial" && sameFiledReturnsScope(summary.scope, scope)
      ? downloadedArtifactTypes(summary.flowStep.safeSignals).filter((artifactType) =>
          artifactTypes.includes(artifactType),
        )
      : completedConcreteArtifactTypeForSelection(summary, scope, artifactTypes);
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
