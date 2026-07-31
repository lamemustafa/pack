import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import { persistCanonicalFiledReturnsFlowSummary } from "./filed-returns-session-summary";
import { clearArtifactAcquisitionCheckpointsAfterPersistedSummary } from "./artifact-acquisition-state";

export async function withPersistedSinglePeriodSummary(
  scope: FiledReturnsDownloadScope,
  response: Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }>,
  deps: FiledReturnsFlowRunnerDeps,
  shouldPersistSinglePeriodSummary: boolean,
): Promise<PackMessageResponse> {
  if (!shouldPersistSinglePeriodSummary) return response;
  if (response.flowSummary) {
    const flowSummary = await persistProvidedSinglePeriodSummary(response.flowSummary, deps);
    if (flowSummary) return responseAfterPersistedSummary(scope, response, flowSummary);
    const responseWithoutSummary = { ...response };
    delete responseWithoutSummary.flowSummary;
    const reconstructedSummary = await persistSinglePeriodSummary(scope, response.flowStep, deps);
    return reconstructedSummary
      ? responseAfterPersistedSummary(scope, responseWithoutSummary, reconstructedSummary)
      : responseWithoutSummary;
  }
  const flowSummary = await persistSinglePeriodSummary(scope, response.flowStep, deps);
  return flowSummary ? responseAfterPersistedSummary(scope, response, flowSummary) : response;
}

async function responseAfterPersistedSummary(
  scope: FiledReturnsDownloadScope,
  response: Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }>,
  flowSummary: FiledReturnsFlowSummary,
): Promise<PackMessageResponse> {
  if (response.flowStep.state === "downloaded") {
    await clearArtifactAcquisitionCheckpointsAfterPersistedSummary(scope);
  }
  return { ...response, flowSummary };
}

async function persistSinglePeriodSummary(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<FiledReturnsFlowSummary | null> {
  const summary = toSinglePeriodSummary(scope, flowStep, deps.now?.() ?? new Date());
  return persistCanonicalFiledReturnsFlowSummary(deps.storageKeys.completion, summary);
}

async function persistProvidedSinglePeriodSummary(
  flowSummary: FiledReturnsFlowSummary,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<FiledReturnsFlowSummary | null> {
  return persistCanonicalFiledReturnsFlowSummary(deps.storageKeys.completion, flowSummary);
}

function toSinglePeriodSummary(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
  now: Date,
): FiledReturnsFlowSummary {
  const isReconciled =
    flowStep.state === "downloaded" ||
    flowStep.safeSignals.includes("filed-return-positively-not-filed");
  const isPartial = flowStep.state === "partial";
  return {
    scope,
    status: isReconciled ? "complete" : isPartial ? "partial" : "blocked",
    ...(isReconciled ? { completedAt: now.toISOString() } : { updatedAt: now.toISOString() }),
    completedPeriods: isReconciled ? [scope.period] : [],
    currentPeriod: scope.period,
    flowStep,
    totalPeriods: 1,
  };
}
