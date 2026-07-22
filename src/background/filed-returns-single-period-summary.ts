import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import { normaliseFiledReturnsArtifactType } from "../core/filed-returns-artifacts";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import { clearVerifiedFiledReturnsActions } from "./filed-returns-action-journal";
import { persistFiledReturnsTargetReview } from "./filed-returns-target-review";

export async function withPersistedSinglePeriodSummary(
  scope: FiledReturnsDownloadScope,
  response: Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }>,
  deps: FiledReturnsFlowRunnerDeps,
  shouldPersistSinglePeriodSummary: boolean,
): Promise<PackMessageResponse> {
  if (!shouldPersistSinglePeriodSummary) return response;
  if (response.flowSummary) {
    await persistProvidedSinglePeriodSummary(response.flowSummary, deps);
    if (response.flowSummary.status === "complete") {
      await clearVerifiedFiledReturnsActions(deps.storageKeys.actionJournal);
    }
    return response;
  }
  const targetReview = response.flowStep.safeSignals.includes(
    "filed-return-no-record-cadence-unresolved",
  )
    ? await persistFiledReturnsTargetReview(scope, response.flowStep, deps)
    : null;
  if (targetReview) {
    await persistProvidedSinglePeriodSummary(targetReview, deps);
    return { ...response, flowSummary: targetReview };
  }
  const flowSummary = await persistSinglePeriodSummary(scope, response.flowStep, deps);
  if (flowSummary.status === "complete") {
    await clearVerifiedFiledReturnsActions(deps.storageKeys.actionJournal);
  }
  return { ...response, flowSummary };
}

export async function clearVerifiedActionsForPersistedCompleteSummary(
  scope: FiledReturnsDownloadScope,
  deps: Pick<FiledReturnsFlowRunnerDeps, "storageKeys">,
): Promise<void> {
  try {
    const values = await browser.storage.session.get(deps.storageKeys.completion);
    const targetId = persistedCompleteSummaryTargetId(values[deps.storageKeys.completion], scope);
    if (!targetId) return;
    await clearVerifiedFiledReturnsActions(deps.storageKeys.actionJournal, targetId);
  } catch {
    // Preserve the verified action for explicit review when session state cannot be read.
  }
}

async function persistSinglePeriodSummary(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<FiledReturnsFlowSummary> {
  const summary = toSinglePeriodSummary(scope, flowStep, deps.now?.() ?? new Date());
  await browser.storage.session.set({ [deps.storageKeys.completion]: summary });
  return summary;
}

async function persistProvidedSinglePeriodSummary(
  flowSummary: FiledReturnsFlowSummary,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<void> {
  await browser.storage.session.set({ [deps.storageKeys.completion]: flowSummary });
}

function persistedCompleteSummaryTargetId(
  value: unknown,
  requestedScope: FiledReturnsDownloadScope,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const summary = value as Partial<FiledReturnsFlowSummary>;
  const scope = summary.scope;
  const artifactType = normaliseFiledReturnsArtifactType(
    requestedScope.returnType,
    requestedScope.artifactType,
  );
  if (
    summary.status !== "complete" ||
    summary.flowStep?.state !== "downloaded" ||
    (artifactType !== "PDF" && artifactType !== "EXCEL") ||
    !scope ||
    typeof scope.financialYear !== "string" ||
    typeof scope.period !== "string" ||
    scope.financialYear !== requestedScope.financialYear ||
    scope.period !== requestedScope.period ||
    scope.rangeEndPeriod !== requestedScope.rangeEndPeriod ||
    scope.returnType !== requestedScope.returnType ||
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType) !== artifactType
  ) {
    return null;
  }
  return `${scope.returnType}:${scope.financialYear}:${scope.period}:${artifactType}`;
}

function toSinglePeriodSummary(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
  now: Date,
): FiledReturnsFlowSummary {
  const isReconciled = flowStep.state === "downloaded";
  return {
    scope,
    status: isReconciled ? "complete" : "blocked",
    ...(isReconciled ? { completedAt: now.toISOString() } : { updatedAt: now.toISOString() }),
    completedPeriods: isReconciled ? [scope.period] : [],
    currentPeriod: scope.period,
    flowStep,
    totalPeriods: 1,
  };
}
