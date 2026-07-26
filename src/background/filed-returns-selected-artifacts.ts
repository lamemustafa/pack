import type {
  FiledReturnsDownloadScope,
  FiledReturnsTargetReview,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import {
  concreteFiledReturnsArtifactTypes,
  normaliseFiledReturnsArtifactType,
  type FiledReturnsConcreteArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import {
  combineDownloadedArtifactFlowSteps,
  markArtifactProgressNeedsReview,
  persistPartialArtifactSummary,
  readPersistedArtifactProgress,
  selectedArtifactsSafeMessage,
  toOptionalArtifactUnavailableFlowStep,
} from "./filed-returns-artifact-progress";
import { triggerAndObserveFiledReturnDownload } from "./filed-returns-download-trigger";
import { exportSinglePeriodFiledReturnsZip } from "./filed-returns-full-fiscal-year-zip";
import {
  clearFiledReturnsTargetReview,
  persistFiledReturnsTargetReview,
  readFiledReturnsTargetReview,
} from "./filed-returns-target-review";
import { persistCanonicalSinglePeriodCompletion } from "./filed-returns-session-summary";
import {
  persistFiledReturnsTargetDownloadId,
  persistFiledReturnsTargetDownloadIntent,
} from "./filed-returns-target-download-attempt";
import { runDownloadStepWithRetry } from "./filed-returns-flow-messaging";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import {
  delay,
  extractActivePeriod,
  getFlowStepSettleMs,
  isFiledReturnDownloadReady,
  MAX_FLOW_STEPS,
  persistFlowResponse,
  shouldContinueFlow,
} from "./filed-returns-flow-runner-utils";
import { toStepLimitReachedFlowStep } from "./filed-returns-step-limit";
import { PACK_LOCAL_STORAGE_KEYS } from "./storage-keys";
import {
  clearSinglePeriodBundleLedger,
  persistSinglePeriodBundleArtifactReview,
  persistSinglePeriodBundleArtifactRunning,
  persistSinglePeriodBundleArtifactStaged,
  persistSinglePeriodBundleArtifactUnavailable,
  persistSinglePeriodBundleCleanupPending,
  persistSinglePeriodBundleZipDownloadId,
  persistSinglePeriodBundleZipIntent,
  readSinglePeriodBundleLedgerStorageState,
  reserveSinglePeriodBundleLedger,
  sameSinglePeriodBundleScope,
  singlePeriodBundleEntryPlan,
  singlePeriodBundleFlowStep,
  type SinglePeriodBundleLedger,
} from "./filed-returns-single-period-bundle-ledger";

export async function preflightSelectedArtifactsRecovery({
  deps,
  scope,
}: {
  deps: FiledReturnsFlowRunnerDeps;
  scope: FiledReturnsDownloadScope;
}): Promise<PackMessageResponse | null> {
  const artifactTypes = concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
  );
  const compatibleDurableSinglePeriodBundle =
    artifactTypes.length > 1 && !deps.stageCapturedDownloads;

  let storageState;
  try {
    storageState = await readSinglePeriodBundleLedgerStorageState();
  } catch {
    return singlePeriodBundleBlockedResponse(
      scope,
      ["single-period-bundle-state-read-failed", "single-period-opfs-retained"],
      "Pack could not verify the retained selected-file recovery ledger, so it did not inspect or act on the GST Portal tab.",
      false,
    );
  }
  if (storageState.state === "missing") return null;
  if (storageState.state === "malformed") {
    return malformedSinglePeriodBundleResponse(scope, storageState.recoverableLedgerId !== null);
  }
  if (storageState.state === "legacy") {
    return malformedSinglePeriodBundleResponse(scope, true);
  }

  const ledger = storageState.ledger;
  if (
    ledger.phase === "artifact-review" ||
    ledger.artifacts.some((artifact) => artifact.status === "running")
  ) {
    return persistAmbiguousSinglePeriodBundleResponse(ledger, deps);
  }
  if (["zip-intent-persisted", "zip-observing", "cleanup-pending"].includes(ledger.phase)) {
    return finalZipSinglePeriodBundleResponse(ledger);
  }
  if (!compatibleDurableSinglePeriodBundle || !sameSinglePeriodBundleScope(ledger.scope, scope)) {
    return conflictingSinglePeriodBundleResponse(ledger);
  }
  return null;
}

export async function triggerSelectedArtifacts({
  activePeriod,
  deps,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  deps: FiledReturnsFlowRunnerDeps;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<PackMessageResponse> {
  const artifactTypes = concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
  );
  const usesDurableSinglePeriodBundle = artifactTypes.length > 1 && !deps.stageCapturedDownloads;
  let singlePeriodBundleLedger: SinglePeriodBundleLedger | null = null;
  if (usesDurableSinglePeriodBundle) {
    const reservation = await reserveSinglePeriodBundleLedger(scope, deps.now?.() ?? new Date());
    if (!reservation) return invalidSinglePeriodBundleResponse(scope);
    if (reservation.state === "malformed") {
      return malformedSinglePeriodBundleResponse(scope, reservation.recoverableLedgerId !== null);
    }
    singlePeriodBundleLedger = reservation.ledger;
    if (!sameSinglePeriodBundleScope(singlePeriodBundleLedger.scope, scope)) {
      return conflictingSinglePeriodBundleResponse(singlePeriodBundleLedger);
    }
    if (
      singlePeriodBundleLedger.phase === "artifact-review" ||
      singlePeriodBundleLedger.artifacts.some((artifact) => artifact.status === "running")
    ) {
      return persistAmbiguousSinglePeriodBundleResponse(singlePeriodBundleLedger, deps);
    }
    if (
      ["zip-intent-persisted", "zip-observing", "cleanup-pending"].includes(
        singlePeriodBundleLedger.phase,
      )
    ) {
      return finalZipSinglePeriodBundleResponse(singlePeriodBundleLedger);
    }
  }
  const singlePeriodBundleLedgerId = singlePeriodBundleLedger?.ledgerId ?? null;
  const artifactDeps: FiledReturnsFlowRunnerDeps = singlePeriodBundleLedgerId
    ? {
        ...deps,
        stageCapturedDownloads: {
          bundleKind: "single-period",
          ledgerId: singlePeriodBundleLedgerId,
        },
      }
    : deps;
  const persistedProgress =
    artifactTypes.length > 1 && !singlePeriodBundleLedgerId
      ? await readPersistedArtifactProgress(scope, artifactTypes, artifactDeps)
      : null;
  const completedArtifactTypes = new Set([
    ...(persistedProgress?.completedArtifactTypes ?? []),
    ...(singlePeriodBundleLedger?.artifacts
      .filter((artifact) => artifact.status === "staged" || artifact.status === "unavailable")
      .map((artifact) => artifact.artifactType) ?? []),
  ]);
  let combinedFlowStep: PortalFlowStepResult | null =
    (singlePeriodBundleLedger ? singlePeriodBundleFlowStep(singlePeriodBundleLedger) : null) ??
    persistedProgress?.flowStep ??
    null;
  let lastResponse: Extract<
    PackMessageResponse,
    { ok: true; flowStep: PortalFlowStepResult }
  > | null = null;

  for (const artifactType of artifactTypes) {
    if (completedArtifactTypes.has(artifactType)) continue;

    const pagePreparation = await preparePageForSelectedArtifact({
      activePeriod,
      artifactType,
      completedArtifactTypes,
      deps: artifactDeps,
      scope,
      tabId,
    });
    if (!pagePreparation.ok) {
      if (singlePeriodBundleLedger) {
        return pendingSinglePeriodBundleResponse(
          singlePeriodBundleLedger,
          pagePreparation.response,
        );
      }
      return pagePreparation.response;
    }
    activePeriod = pagePreparation.activePeriod;

    if (singlePeriodBundleLedger) {
      const runningLedger = await persistSinglePeriodBundleArtifactRunning(
        singlePeriodBundleLedger,
        artifactType,
        deps.now?.() ?? new Date(),
      );
      if (!runningLedger) return staleSinglePeriodBundleResponse(singlePeriodBundleLedger);
      singlePeriodBundleLedger = runningLedger;
    }

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod,
      artifactType,
      deps: artifactDeps,
      scope,
      tabId,
    });
    if (!response.ok || !("flowStep" in response)) {
      if (singlePeriodBundleLedger) {
        const reviewLedger = await persistSinglePeriodBundleArtifactReview(
          singlePeriodBundleLedger,
          artifactType,
          unresolvedArtifactStep(scope),
          deps.now?.() ?? new Date(),
        );
        return persistAmbiguousSinglePeriodBundleResponse(
          reviewLedger ?? singlePeriodBundleLedger,
          deps,
          unresolvedArtifactStep(scope),
        );
      }
      return response;
    }
    if (response.flowStep.state !== "downloaded") {
      const unavailableArtifactFlowStep = toOptionalArtifactUnavailableFlowStep({
        artifactType,
        artifactTypes,
        combinedFlowStep,
        nextFlowStep: response.flowStep,
        scope,
      });
      if (unavailableArtifactFlowStep) {
        if (singlePeriodBundleLedger) {
          const unavailableLedger = await persistSinglePeriodBundleArtifactUnavailable(
            singlePeriodBundleLedger,
            artifactType,
            response.flowStep,
            deps.now?.() ?? new Date(),
          );
          if (!unavailableLedger) {
            return persistAmbiguousSinglePeriodBundleResponse(
              singlePeriodBundleLedger,
              deps,
              response.flowStep,
            );
          }
          singlePeriodBundleLedger = unavailableLedger;
          combinedFlowStep = singlePeriodBundleFlowStep(unavailableLedger);
          if (!combinedFlowStep) return staleSinglePeriodBundleResponse(unavailableLedger);
          lastResponse = { ...response, flowStep: combinedFlowStep };
          completedArtifactTypes.add(artifactType);
          continue;
        }
        lastResponse = { ...response, flowStep: unavailableArtifactFlowStep };
        completedArtifactTypes.add(artifactType);
        combinedFlowStep = unavailableArtifactFlowStep;
        continue;
      }

      if (singlePeriodBundleLedger) {
        const reviewLedger = await persistSinglePeriodBundleArtifactReview(
          singlePeriodBundleLedger,
          artifactType,
          response.flowStep,
          deps.now?.() ?? new Date(),
        );
        return persistAmbiguousSinglePeriodBundleResponse(
          reviewLedger ?? singlePeriodBundleLedger,
          deps,
          response.flowStep,
        );
      }

      if (!combinedFlowStep || artifactTypes.length === 1) {
        return response;
      }

      const flowStep = markArtifactProgressNeedsReview(
        combineDownloadedArtifactFlowSteps(combinedFlowStep, response.flowStep, scope),
        response,
      );
      const flowSummary = await persistPartialArtifactSummary(scope, flowStep, deps);
      return {
        ...response,
        flowStep,
        flowSummary,
      };
    }

    lastResponse = response;
    completedArtifactTypes.add(artifactType);
    if (singlePeriodBundleLedger) {
      const stagedLedger = await persistSinglePeriodBundleArtifactStaged(
        singlePeriodBundleLedger,
        artifactType,
        response.flowStep,
        deps.now?.() ?? new Date(),
      );
      if (!stagedLedger) {
        return persistAmbiguousSinglePeriodBundleResponse(
          singlePeriodBundleLedger,
          deps,
          response.flowStep,
        );
      }
      singlePeriodBundleLedger = stagedLedger;
      combinedFlowStep = singlePeriodBundleFlowStep(stagedLedger);
      if (!combinedFlowStep) return staleSinglePeriodBundleResponse(stagedLedger);
    } else {
      combinedFlowStep = combineDownloadedArtifactFlowSteps(
        combinedFlowStep,
        response.flowStep,
        scope,
      );
    }
    if (
      artifactTypes.length > 1 &&
      completedArtifactTypes.size < artifactTypes.length &&
      !singlePeriodBundleLedgerId
    ) {
      await persistPartialArtifactSummary(scope, combinedFlowStep, artifactDeps);
    }
  }

  if (!combinedFlowStep) {
    if (singlePeriodBundleLedger) {
      return staleSinglePeriodBundleResponse(singlePeriodBundleLedger);
    }
    return {
      ok: false,
      error: "Pack could not resolve a filed-return artifact selection.",
    };
  }

  const completedResponse = lastResponse ?? { ok: true as const, flowStep: combinedFlowStep };
  const response: PackMessageResponse = {
    ...completedResponse,
    flowStep:
      artifactTypes.length === 1
        ? combinedFlowStep
        : {
            ...combinedFlowStep,
            safeMessage: selectedArtifactsSafeMessage(combinedFlowStep),
          },
  };
  if (!singlePeriodBundleLedgerId || artifactTypes.length === 1 || !response.ok) return response;
  if (!("flowStep" in response) || response.flowStep.state !== "downloaded") {
    return singlePeriodBundleLedger
      ? staleSinglePeriodBundleResponse(singlePeriodBundleLedger)
      : response;
  }
  if (!response.flowStep.safeSignals.includes("single-period-opfs-staged")) {
    return singlePeriodBundleLedger
      ? staleSinglePeriodBundleResponse(singlePeriodBundleLedger)
      : response;
  }
  if (!singlePeriodBundleLedger) return staleSinglePeriodBundleResponse(null, scope);
  const entryPlan = singlePeriodBundleEntryPlan(singlePeriodBundleLedger);
  if (!entryPlan) return staleSinglePeriodBundleResponse(singlePeriodBundleLedger);

  const zipCheckpointDeps = {
    ...artifactDeps,
    storageKeys: {
      ...artifactDeps.storageKeys,
      targetReview: artifactDeps.storageKeys.targetReview ?? PACK_LOCAL_STORAGE_KEYS.targetReview,
    },
  };

  const zipFlowStep = await exportSinglePeriodFiledReturnsZip({
    completeStep: response.flowStep,
    entryPlan,
    ledgerId: singlePeriodBundleLedgerId,
    options: {
      onAfterStagingCleared: async (outcome) => {
        if (!singlePeriodBundleLedger) {
          throw new Error("single-period bundle cleanup checkpoint missing");
        }
        let targetReview = await readFiledReturnsTargetReview(scope, zipCheckpointDeps);
        if (!canClearSinglePeriodBundleRecovery(singlePeriodBundleLedger, targetReview)) {
          throw new Error("single-period bundle cleanup checkpoint mismatch");
        }
        if (outcome === "downloaded") {
          const stagedFlowStep = singlePeriodBundleFlowStep(singlePeriodBundleLedger);
          if (!stagedFlowStep) {
            throw new Error("single-period bundle completion evidence missing");
          }
          const completionStep: PortalFlowStepResult = {
            ...stagedFlowStep,
            safeSignals: Array.from(
              new Set([
                ...stagedFlowStep.safeSignals,
                "single-period-zip-downloaded",
                "single-period-opfs-cleared",
              ]),
            ),
            safeMessage:
              "Pack confirmed the selected-file ZIP and saved its completion before clearing recovery checkpoints.",
          };
          const completionCheckpoint = await persistFiledReturnsTargetReview(
            scope,
            {
              ...completionStep,
              state: "download-unconfirmed",
              safeMessage:
                "Pack confirmed the selected-file ZIP and is clearing its local recovery checkpoints.",
              userAction: {
                type: "RETRY_PORTAL_GENERATION",
                message: "Retry only if Pack cannot finish clearing the saved ZIP checkpoint.",
                canResume: true,
              },
            },
            zipCheckpointDeps,
          );
          if (!completionCheckpoint) {
            throw new Error("single-period ZIP completion checkpoint failed");
          }
          targetReview = await readFiledReturnsTargetReview(scope, zipCheckpointDeps);
          if (!canClearSinglePeriodBundleRecovery(singlePeriodBundleLedger, targetReview)) {
            throw new Error("single-period ZIP completion checkpoint mismatch");
          }
          const durableCompletion = await persistCanonicalSinglePeriodCompletion(
            zipCheckpointDeps.storageKeys.completion,
            scope,
            completionStep,
            deps.now?.() ?? new Date(),
          );
          if (!durableCompletion) {
            throw new Error("single-period ZIP canonical completion checkpoint failed");
          }
        }
        const bundleCleared = await clearSinglePeriodBundleLedger(
          singlePeriodBundleLedger.ledgerId,
          singlePeriodBundleLedger.revision,
        );
        if (!bundleCleared) {
          throw new Error("single-period bundle cleanup checkpoint failed");
        }
        if (targetReview) {
          const reviewCleared = await clearFiledReturnsTargetReview(
            scope,
            zipCheckpointDeps,
            targetReview.revision ?? 1,
          );
          if (!reviewCleared) {
            throw new Error("single-period ZIP target-review cleanup failed");
          }
        }
      },
      onBeforeDownloadStart: async (requestedAt) => {
        const persisted = await persistFiledReturnsTargetDownloadIntent(
          scope,
          {
            artifactType: "ZIP",
            kind: "single-period-zip",
            phase: "download-intent-persisted",
            requestedAt: requestedAt.toISOString(),
            stagingLedgerId: singlePeriodBundleLedgerId,
          },
          zipCheckpointDeps,
          response.flowStep,
        );
        if (!persisted) throw new Error("single-period ZIP intent checkpoint failed");
        const intentLedger = await persistSinglePeriodBundleZipIntent(
          singlePeriodBundleLedger!,
          requestedAt,
        );
        if (!intentLedger) throw new Error("single-period bundle ZIP intent checkpoint failed");
        singlePeriodBundleLedger = intentLedger;
      },
      onDownloadStarted: async (downloadId) => {
        const persisted = await persistFiledReturnsTargetDownloadId(
          scope,
          downloadId,
          zipCheckpointDeps,
        );
        if (!persisted) throw new Error("single-period ZIP download ID checkpoint failed");
        const observingLedger = await persistSinglePeriodBundleZipDownloadId(
          singlePeriodBundleLedger!,
          downloadId,
          new Date(),
        );
        if (!observingLedger) {
          throw new Error("single-period bundle ZIP download ID checkpoint failed");
        }
        singlePeriodBundleLedger = observingLedger;
      },
    },
    scope,
  });

  if (
    zipFlowStep.safeSignals.includes("single-period-zip-downloaded") &&
    zipFlowStep.safeSignals.includes("single-period-opfs-clear-failed") &&
    singlePeriodBundleLedger.phase === "zip-observing"
  ) {
    const cleanupLedger = await persistSinglePeriodBundleCleanupPending(
      singlePeriodBundleLedger,
      new Date(),
    );
    if (cleanupLedger) singlePeriodBundleLedger = cleanupLedger;
  }

  if (zipFlowStep.safeSignals.includes("single-period-cleanup-checkpoints-cleared")) {
    return { ...response, flowStep: zipFlowStep };
  }
  const flowSummary = await persistFiledReturnsTargetReview(scope, zipFlowStep, zipCheckpointDeps);
  return {
    ...response,
    flowStep: zipFlowStep,
    ...(flowSummary ? { flowSummary } : {}),
  };
}

function invalidSinglePeriodBundleResponse(scope: FiledReturnsDownloadScope): PackMessageResponse {
  return singlePeriodBundleBlockedResponse(
    scope,
    ["single-period-bundle-state-persist-failed"],
    "Pack could not save the selected-file recovery ledger, so it did not click a download control.",
    false,
  );
}

function malformedSinglePeriodBundleResponse(
  scope: FiledReturnsDownloadScope,
  retainsRecoverableLedger: boolean,
): PackMessageResponse {
  return singlePeriodBundleBlockedResponse(
    scope,
    [
      "single-period-bundle-ledger-malformed",
      ...(retainsRecoverableLedger ? ["single-period-opfs-retained"] : []),
    ],
    "Pack found damaged selected-file recovery metadata and cannot verify which artifacts remain staged.",
    false,
  );
}

function conflictingSinglePeriodBundleResponse(
  ledger: SinglePeriodBundleLedger,
): PackMessageResponse {
  return singlePeriodBundleBlockedResponse(
    ledger.scope,
    ["single-period-bundle-scope-conflict", "single-period-opfs-retained"],
    "Pack retained a different selected-file run and will not replace or mix its staged artifacts.",
    false,
  );
}

function ambiguousSinglePeriodBundleResponse(
  ledger: SinglePeriodBundleLedger,
  causeStep?: PortalFlowStepResult,
): PackMessageResponse {
  return singlePeriodBundleBlockedResponse(
    ledger.scope,
    [
      ...(causeStep?.safeSignals ?? []),
      "single-period-bundle-artifact-review-required",
      "single-period-bundle-running-ambiguous",
      "single-period-opfs-retained",
    ],
    "Pack stopped because a selected artifact may already have been clicked before the prior run ended. It will not click that artifact again.",
    false,
  );
}

async function persistAmbiguousSinglePeriodBundleResponse(
  ledger: SinglePeriodBundleLedger,
  deps: FiledReturnsFlowRunnerDeps,
  causeStep?: PortalFlowStepResult,
): Promise<PackMessageResponse> {
  const response = ambiguousSinglePeriodBundleResponse(ledger, causeStep);
  if (!response.ok || !("flowStep" in response)) return response;

  let flowSummary;
  try {
    flowSummary = await persistFiledReturnsTargetReview(
      ledger.scope,
      response.flowStep,
      {
        ...deps,
        storageKeys: {
          ...deps.storageKeys,
          targetReview: deps.storageKeys.targetReview ?? PACK_LOCAL_STORAGE_KEYS.targetReview,
        },
      },
      {
        singlePeriodBundleCheckpoint: {
          ledgerId: ledger.ledgerId,
          revision: ledger.revision,
        },
      },
    );
  } catch {
    flowSummary = null;
  }
  if (!flowSummary) {
    return singlePeriodBundleBlockedResponse(
      ledger.scope,
      Array.from(
        new Set([
          ...response.flowStep.safeSignals,
          "single-period-bundle-state-persist-failed",
          "single-period-opfs-retained",
        ]),
      ),
      "Pack retained the interrupted selected-file bundle but could not save its target review, so it will not continue automatically.",
      false,
    );
  }
  return {
    ...response,
    flowStep: flowSummary.flowStep,
    flowSummary,
  };
}

function finalZipSinglePeriodBundleResponse(ledger: SinglePeriodBundleLedger): PackMessageResponse {
  return singlePeriodBundleBlockedResponse(
    ledger.scope,
    [
      ledger.phase === "cleanup-pending"
        ? "single-period-opfs-cleanup-required"
        : "single-period-zip-download-reconciliation-required",
      `single-period-bundle-phase:${ledger.phase}`,
      "single-period-opfs-retained",
    ],
    ledger.phase === "cleanup-pending"
      ? "Pack confirmed the selected-file ZIP checkpoint but still needs to clear its temporary staging."
      : "Pack retained a final ZIP recovery checkpoint and will not start another ZIP until it is reconciled.",
    true,
  );
}

function pendingSinglePeriodBundleResponse(
  ledger: SinglePeriodBundleLedger,
  response: PackMessageResponse,
): PackMessageResponse {
  const fallback = unresolvedArtifactStep(ledger.scope);
  const sourceStep = response.ok && "flowStep" in response ? response.flowStep : fallback;
  const flowStep: PortalFlowStepResult = {
    ...sourceStep,
    state: "blocked",
    safeSignals: Array.from(
      new Set([
        ...sourceStep.safeSignals,
        "single-period-bundle-resume-pending",
        "single-period-opfs-retained",
      ]),
    ),
    safeMessage:
      "Pack retained the selected-file plan before the next artifact click. Retry from the same target to continue only the pending artifact.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Retry from the same filed-return target to continue the pending artifact.",
      canResume: true,
    },
  };
  return singlePeriodBundleResponse(ledger.scope, flowStep);
}

function staleSinglePeriodBundleResponse(
  ledger: SinglePeriodBundleLedger | null,
  fallbackScope?: FiledReturnsDownloadScope,
): PackMessageResponse {
  const scope = ledger?.scope ?? fallbackScope;
  if (!scope) {
    return { ok: false, error: "Pack could not verify the selected-file recovery state." };
  }
  return singlePeriodBundleBlockedResponse(
    scope,
    ["single-period-bundle-revision-conflict", "single-period-opfs-retained"],
    "Pack found newer selected-file recovery state and stopped before another portal click.",
    false,
  );
}

function singlePeriodBundleBlockedResponse(
  scope: FiledReturnsDownloadScope,
  safeSignals: string[],
  safeMessage: string,
  canResume: boolean,
): PackMessageResponse {
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: filedReturnScopeId(scope.returnType),
    state: "blocked",
    safeSignals,
    safeMessage,
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: canResume
        ? "Retry so Pack can reconcile the saved selected-file state."
        : "Use Clear local Pack data only after reviewing the retained selected-file run.",
      canResume,
    },
  };
  return singlePeriodBundleResponse(scope, flowStep);
}

function singlePeriodBundleResponse(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
): PackMessageResponse {
  return {
    ok: true,
    flowStep,
    flowSummary: {
      completedPeriods: [],
      currentPeriod: scope.period,
      flowStep,
      scope,
      status: "blocked",
      totalPeriods: 1,
    },
  };
}

function unresolvedArtifactStep(scope: FiledReturnsDownloadScope): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(scope.returnType),
    state: "blocked",
    safeSignals: ["single-period-bundle-artifact-result-unavailable"],
    safeMessage:
      "Pack could not verify the selected artifact result after saving its running checkpoint.",
  };
}

function canClearSinglePeriodBundleRecovery(
  ledger: SinglePeriodBundleLedger,
  review: FiledReturnsTargetReview | null,
): boolean {
  const attempt = review?.downloadAttempt;
  if (ledger.phase === "ready-for-zip") {
    return (
      !review ||
      (attempt?.kind === "single-period-zip" &&
        attempt.phase === "download-intent-persisted" &&
        attempt.stagingLedgerId === ledger.ledgerId)
    );
  }
  if (!attempt || attempt.kind !== "single-period-zip") return false;
  if (
    attempt.stagingLedgerId !== ledger.ledgerId ||
    attempt.requestedAt !== ledger.zipDownloadAttempt?.requestedAt
  ) {
    return false;
  }
  if (ledger.phase === "zip-intent-persisted") {
    return attempt.phase === "download-intent-persisted";
  }
  return (
    ledger.phase === "zip-observing" &&
    attempt.phase === "download-observing" &&
    attempt.downloadId === ledger.zipDownloadAttempt?.downloadId
  );
}

async function preparePageForSelectedArtifact({
  activePeriod,
  artifactType,
  completedArtifactTypes,
  deps,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  artifactType: FiledReturnsConcreteArtifactType;
  completedArtifactTypes: ReadonlySet<FiledReturnsConcreteArtifactType>;
  deps: FiledReturnsFlowRunnerDeps;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<
  { ok: true; activePeriod: string | null } | { ok: false; response: PackMessageResponse }
> {
  if (
    scope.returnType !== "GSTR-1" ||
    scope.artifactType !== "PDF_AND_EXCEL" ||
    artifactType !== "EXCEL" ||
    !completedArtifactTypes.has("PDF")
  ) {
    return { ok: true, activePeriod };
  }

  return waitForGstr1ExcelDetailReady({
    activePeriod,
    deps,
    scope: { ...scope, artifactType: "EXCEL" },
    tabId,
  });
}

async function waitForGstr1ExcelDetailReady({
  activePeriod,
  deps,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  deps: FiledReturnsFlowRunnerDeps;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<
  { ok: true; activePeriod: string | null } | { ok: false; response: PackMessageResponse }
> {
  let lastStep: PortalFlowStepResult | null = null;
  let nextActivePeriod = activePeriod;

  for (let attempt = 0; attempt < MAX_FLOW_STEPS; attempt += 1) {
    const response = await runDownloadStepWithRetry(deps, tabId, {
      type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      payload: scope,
    });
    if (!response.ok || !("flowStep" in response)) {
      return { ok: false, response };
    }

    await persistFlowResponse(response, deps);
    lastStep = response.flowStep;
    nextActivePeriod = extractActivePeriod(lastStep) ?? nextActivePeriod;

    if (isFiledReturnDownloadReady(lastStep, scope)) {
      return { ok: true, activePeriod: nextActivePeriod };
    }

    if (!shouldContinueFlow(lastStep)) {
      return { ok: false, response };
    }
    await delay(getFlowStepSettleMs(lastStep, deps));
  }

  return {
    ok: false,
    response: {
      ok: true,
      flowStep: toStepLimitReachedFlowStep(scope, lastStep, {
        safeSignal: "gstr1-excel-detail-step-limit-reached",
        safeMessage:
          "Pack downloaded the filed GSTR-1 summary PDF but did not reach the e-invoice details Excel control before Pack's retry limit. Wait for the GST Portal detail page to finish loading, then click Start download again.",
        userActionMessage:
          "Wait for the GST Portal detail page to finish loading, then click Start download again.",
      }),
    },
  };
}
