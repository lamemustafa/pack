import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import { concreteFiledReturnsArtifactTypesForSelection } from "../connectors/gst/filed-returns-artifacts";
import {
  clearArtifactAcquisitionCheckpointsAfterPersistedSummary,
  type ArtifactAcquisitionCompletionEvidence,
} from "./artifact-acquisition-state";
import { persistCanonicalFiledReturnsFlowSummary } from "./filed-returns-session-summary";

export function artifactAcquisitionCompletionFlowStep(
  scope: FiledReturnsDownloadScope,
  evidence: readonly ArtifactAcquisitionCompletionEvidence[],
  diagnosticState: Pick<PortalFlowStepResult, "downloadDiagnostic" | "downloadDiagnostics"> = {},
): PortalFlowStepResult | null {
  const selectedArtifactTypes = concreteFiledReturnsArtifactTypesForSelection(
    scope.returnType,
    scope.artifactType,
  );
  if (
    selectedArtifactTypes.length !== 1 ||
    evidence.length !== 1 ||
    evidence[0]?.artifactType !== selectedArtifactTypes[0]
  ) {
    return null;
  }
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(scope.returnType),
    state: "downloaded",
    safeSignals: [
      "artifact-acquisition-download-reconciled",
      "browser-download-created",
      "browser-download-completed",
      "browser-download-non-empty",
      ...evidence.map(({ downloadId }) => `browser-download-id:${downloadId}`),
    ],
    safeMessage:
      "Pack reconciled this target from exact browser download evidence without repeating a portal action.",
    ...diagnosticState,
  };
}

/** Persists a completion before removing the exact-ID checkpoint that proves it. */
export async function persistArtifactAcquisitionCompletion(
  completionKey: string | undefined,
  scope: FiledReturnsDownloadScope,
  evidence: readonly ArtifactAcquisitionCompletionEvidence[],
  now: Date,
  diagnosticState: Pick<PortalFlowStepResult, "downloadDiagnostic" | "downloadDiagnostics"> = {},
): Promise<FiledReturnsFlowSummary | null> {
  if (!completionKey) return null;
  const flowStep = artifactAcquisitionCompletionFlowStep(scope, evidence, diagnosticState);
  if (!flowStep) return null;
  const summary = await persistCanonicalFiledReturnsFlowSummary(completionKey, {
    artifactAcquisitionCompletion: evidence.map(({ artifactType, downloadId, requestId }) => ({
      artifactType,
      downloadId,
      requestId,
    })),
    completedAt: now.toISOString(),
    completedPeriods: [scope.period],
    currentPeriod: scope.period,
    flowStep,
    scope,
    status: "complete",
    totalPeriods: 1,
  });
  if (!summary) return null;
  await clearArtifactAcquisitionCheckpointsAfterPersistedSummary(scope, evidence);
  return summary;
}
