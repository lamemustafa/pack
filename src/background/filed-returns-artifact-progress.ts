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
import { closeOffscreenBlobDocument, clearOffscreenFiledReturnLedger } from "./offscreen-blob-url";
import { PACK_LOCAL_STORAGE_KEYS } from "./storage-keys";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";

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
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `single-period:${suffix.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}

export async function reserveSinglePeriodBundleLedger(): Promise<string | null> {
  let existing: SinglePeriodStagingRecord | null;
  try {
    existing = await readSinglePeriodStagingRecord();
  } catch {
    return null;
  }
  if (existing) {
    const cleared = await clearOffscreenFiledReturnLedger(existing.ledgerId).catch(() => "failed");
    await closeOffscreenBlobDocument();
    if (cleared !== "cleared") return null;
    await clearSinglePeriodStagingRecord(existing.ledgerId);
  }

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

export async function clearSinglePeriodStagingRecord(ledgerId: string): Promise<void> {
  const record = await readSinglePeriodStagingRecord().catch(() => null);
  if (record?.ledgerId !== ledgerId) return;
  await browser.storage.local.remove(PACK_LOCAL_STORAGE_KEYS.singlePeriodStaging).catch(() => {});
}

function recoverableSinglePeriodLedgerId(
  candidate: Partial<SinglePeriodStagingRecord>,
): string | null {
  return typeof candidate.ledgerId === "string" &&
    candidate.ledgerId.length <= 120 &&
    /^single-period:[a-zA-Z0-9._-]+$/.test(candidate.ledgerId)
    ? candidate.ledgerId
    : null;
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
