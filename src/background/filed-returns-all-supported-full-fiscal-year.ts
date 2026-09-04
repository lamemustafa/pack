import type {
  FiledReturnsAllSupportedFullFiscalYearFlowSummary,
  FiledReturnsAllSupportedFullFiscalYearRequest,
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearTargetStatus,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { concreteFiledReturnsArtifactTypesForSelection } from "../connectors/gst/filed-returns-artifacts";
import { expandAllSupportedFullFiscalYearTargetPlan } from "../connectors/gst/filed-returns-all-supported-full-fiscal-year";
import { getFiledReturnsFullFiscalYearPeriods } from "../connectors/gst/filed-returns-scope";
import type {
  AllSupportedFullFiscalYearTargetRecoveryPayload,
  PackMessageResponse,
} from "../connectors/gst/messages";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import type {
  FiledReturnsFlowRunnerDeps,
  FiledReturnsFlowStepCategory,
} from "./filed-returns-flow-runner";
import type { SinglePeriodRunner } from "./filed-returns-full-fiscal-year";
import {
  allSupportedResumeMode,
  allSupportedExplicitRetryTarget,
  canCompleteAllSupportedFullFiscalYearLedger,
  createAllSupportedFullFiscalYearLedger,
  isAllSupportedFullFiscalYearLedgerStale,
  markAllSupportedFullFiscalYearTargetRunning,
  markAllSupportedFullFiscalYearTargetTerminal,
  nextRunnableAllSupportedFullFiscalYearTarget,
} from "./filed-returns-all-supported-full-fiscal-year-ledger";
import { allSupportedTerminalPlanRoots } from "./filed-returns-all-supported-full-fiscal-year-summary";
import {
  readAllSupportedFullFiscalYearLedgerForPlanRoot,
  readAllSupportedPlanLedgersStorageState,
  persistAllSupportedFullFiscalYearLedger,
  savedPlanStorageStateStep,
} from "./filed-returns-all-supported-full-fiscal-year-run-state";
import type {
  AllSupportedFullFiscalYearZipPhase,
  FiledReturnsAllSupportedFullFiscalYearLedger,
  FiledReturnsAllSupportedFullFiscalYearTarget,
} from "./filed-returns-all-supported-full-fiscal-year-validation";
import {
  discardAllSupportedFullFiscalYearFiledReturnsZip,
  exportAllSupportedFullFiscalYearZip,
  reconcileAllSupportedFullFiscalYearZipDownload,
} from "./filed-returns-all-supported-full-fiscal-year-zip";
import { targetStatusFromFlowStep } from "./filed-returns-full-fiscal-year-summary";
import { canonicalDurableTargetStatus } from "../connectors/gst/filed-returns-durable-status";

type AllSupportedRunnerDeps = FiledReturnsFlowRunnerDeps & {
  storageKeys: FiledReturnsFlowRunnerDeps["storageKeys"] & {
    allSupportedFullFiscalYearLedgerIndex: string;
  };
};

type SystemErrorPredecessor = FiledReturnsFlowStepCategory | "initial";

const POSITIVE_TARGET_STATUSES = new Set<FiledReturnsFullFiscalYearTargetStatus>([
  "downloaded",
  "not-filed",
]);
const MAX_DURABLE_FLOW_SIGNALS = 32;

/**
 * Reconciles a terminal final-ZIP event only when exactly one valid persisted
 * all-supported plan owns that browser download ID. An unrelated event, a
 * malformed index, or duplicate owners is deliberately left reviewable.
 */
export async function reconcilePendingAllSupportedFullFiscalYearZipDownload(
  downloadId: number,
  deps: AllSupportedRunnerDeps,
): Promise<boolean> {
  if (!Number.isSafeInteger(downloadId) || downloadId < 0) return false;
  const storageState = await readAllSupportedPlanLedgersStorageState(deps);
  if (storageState.state !== "valid") return false;
  const owners = allSupportedZipOwners(storageState.ledgers, downloadId);
  if (owners.length !== 1) return false;
  await reconcileAllSupportedFinalZip(deps, owners[0]!);
  return true;
}

/**
 * Rechecks exact persisted final-ZIP IDs when an MV3 worker starts. Each ID
 * must have one valid durable owner; duplicate or malformed state is never
 * adopted as a successful download.
 */
export async function reconcilePersistedAllSupportedFullFiscalYearZipDownload(
  deps: AllSupportedRunnerDeps,
): Promise<boolean> {
  const storageState = await readAllSupportedPlanLedgersStorageState(deps);
  if (storageState.state !== "valid") return false;
  const ownersByDownloadId = new Map<number, FiledReturnsAllSupportedFullFiscalYearLedger[]>();
  for (const ledger of storageState.ledgers) {
    const downloadId = ledger.zipDownloadAttempt?.downloadId;
    if (
      ledger.zipPhase !== "download-observing" ||
      typeof downloadId !== "number" ||
      !Number.isSafeInteger(downloadId) ||
      downloadId < 0
    ) {
      continue;
    }
    const owners = ownersByDownloadId.get(downloadId) ?? [];
    owners.push(ledger);
    ownersByDownloadId.set(downloadId, owners);
  }

  let handled = false;
  for (const owners of ownersByDownloadId.values()) {
    if (owners.length !== 1) continue;
    await reconcileAllSupportedFinalZip(deps, owners[0]!);
    handled = true;
  }
  return handled;
}

/**
 * Runs the immutable all-supported-returns target plan. The root request is
 * never converted into a multi-return scope: every portal operation still
 * receives exactly one atomic scope from the persisted target snapshot.
 */
export async function startAllSupportedFullFiscalYearDownloadFlow(
  request: FiledReturnsAllSupportedFullFiscalYearRequest,
  deps: AllSupportedRunnerDeps,
  runSinglePeriod: SinglePeriodRunner,
): Promise<PackMessageResponse> {
  const now = deps.now?.() ?? new Date();
  const periodPlan = getFiledReturnsFullFiscalYearPeriods(request.financialYear, now);
  const storageState = await readAllSupportedPlanLedgersStorageState(deps);
  if (storageState.state !== "valid") {
    return {
      ok: true,
      flowStep: savedPlanStorageStateStep(request.financialYear, storageState.state),
    };
  }
  let ledger = await readAllSupportedFullFiscalYearLedgerForPlanRoot(deps, request);

  if (ledger) {
    if (
      ledger.status === "complete" &&
      periodPlan.length > 0 &&
      periodPlan.length > persistedPeriodPlanLength(ledger)
    ) {
      const expansion = expandAllSupportedFullFiscalYearTargetPlan();
      if (!expansion.ok) {
        return {
          ok: true,
          flowStep: expansionFailureStep(request.financialYear, expansion.reason),
        };
      }
      ledger = createAllSupportedFullFiscalYearLedger(request, expansion.targets, periodPlan, now);
      await persistAllSupportedFullFiscalYearLedger(deps, ledger);
      return runAllSupportedFullFiscalYearTargets(deps, ledger, runSinglePeriod);
    }
    return continueSavedAllSupportedFullFiscalYearRun(deps, ledger, runSinglePeriod);
  }

  if (periodPlan.length === 0) {
    return { ok: true, flowStep: noEligiblePeriodsStep(request.financialYear) };
  }
  const expansion = expandAllSupportedFullFiscalYearTargetPlan();
  if (!expansion.ok) {
    return { ok: true, flowStep: expansionFailureStep(request.financialYear, expansion.reason) };
  }

  ledger = createAllSupportedFullFiscalYearLedger(request, expansion.targets, periodPlan, now);
  // The target plan is durable before the first portal action. A worker restart
  // cannot turn an unrecorded attempted target into an inferred completion.
  await persistAllSupportedFullFiscalYearLedger(deps, ledger);
  return runAllSupportedFullFiscalYearTargets(deps, ledger, runSinglePeriod);
}

/**
 * Replaces only a verified, cleanly completed root after an explicit restart.
 * The replacement is durably indexed before the completed history is removed:
 * an MV3 suspension cannot turn this action into an unrecorded fresh run.
 */
export async function restartCompletedAllSupportedFullFiscalYearPlan(
  request: FiledReturnsAllSupportedFullFiscalYearRequest & { ledgerId?: string },
  deps: AllSupportedRunnerDeps,
  runSinglePeriod: SinglePeriodRunner,
): Promise<PackMessageResponse> {
  const storageState = await readAllSupportedPlanLedgersStorageState(deps);
  if (storageState.state !== "valid") {
    return {
      ok: true,
      flowStep: savedPlanStorageStateStep(request.financialYear, storageState.state),
    };
  }
  const ledger = await readAllSupportedFullFiscalYearLedgerForPlanRoot(deps, request);
  if (!ledger) {
    return {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-private-v0",
        state: "blocked",
        safeSignals: ["all-supported-full-fiscal-year-restart-plan-not-found"],
        safeMessage:
          "Pack could not find the saved fiscal-year plan to restart. Refresh this panel and try again.",
      },
    };
  }
  // The request names the ledger the reader reviewed. If another surface
  // replaced or completed this root in between, the indexed ledger is no
  // longer the plan they authorised discarding -- and this path removes it.
  if (request.ledgerId !== ledger.ledgerId) {
    return allSupportedResponse(deps, ledger, {
      ...unresolvedRunStep(ledger),
      safeSignals: [
        ...unresolvedRunStep(ledger).safeSignals,
        "all-supported-full-fiscal-year-restart-plan-superseded",
      ],
      safeMessage:
        "This fiscal-year plan changed since Pack showed it. Refresh this panel and check it before discarding.",
    });
  }
  if (ledger.status !== "complete" || !ledger.zipPhase || !isCleanedZipPhase(ledger.zipPhase)) {
    return allSupportedResponse(deps, ledger, {
      ...unresolvedRunStep(ledger),
      safeSignals: [
        ...unresolvedRunStep(ledger).safeSignals,
        "all-supported-full-fiscal-year-restart-plan-not-terminal",
      ],
      safeMessage:
        "Pack will not discard this fiscal-year plan until its saved recovery work is complete.",
    });
  }
  const clearSignals = await discardAllSupportedFullFiscalYearFiledReturnsZip(ledger.ledgerId);
  if (!clearSignals.includes("all-supported-full-fiscal-year-opfs-cleared")) {
    return allSupportedResponse(deps, ledger, {
      ...unresolvedRunStep(ledger),
      safeSignals: [
        ...unresolvedRunStep(ledger).safeSignals,
        "all-supported-full-fiscal-year-restart-local-cleanup-failed",
      ],
      safeMessage:
        "Pack could not clear the retained local staging for this fiscal-year plan. The saved plan remains unchanged.",
    });
  }
  const now = deps.now?.() ?? new Date();
  const periodPlan = getFiledReturnsFullFiscalYearPeriods(request.financialYear, now);
  if (periodPlan.length === 0) {
    return { ok: true, flowStep: noEligiblePeriodsStep(request.financialYear) };
  }
  const expansion = expandAllSupportedFullFiscalYearTargetPlan();
  if (!expansion.ok) {
    return { ok: true, flowStep: expansionFailureStep(request.financialYear, expansion.reason) };
  }
  const replacement = createAllSupportedFullFiscalYearLedger(
    { kind: request.kind, financialYear: request.financialYear },
    expansion.targets,
    periodPlan,
    now,
  );
  await persistAllSupportedFullFiscalYearLedger(deps, replacement);
  return runAllSupportedFullFiscalYearTargets(deps, replacement, runSinglePeriod);
}

/**
 * Replays exactly one reader-reviewed, terminal child target. This is not a
 * reconciliation of its earlier browser download: a retry happens only after
 * an explicit message bound to the current immutable ledger revision.
 */
export async function retryAllSupportedFullFiscalYearTarget(
  payload: AllSupportedFullFiscalYearTargetRecoveryPayload,
  deps: AllSupportedRunnerDeps,
  runSinglePeriod: SinglePeriodRunner,
): Promise<PackMessageResponse> {
  const planRoot = {
    kind: "all-supported-returns-full-fiscal-year" as const,
    financialYear: payload.financialYear,
  };
  const ledger = await readAllSupportedFullFiscalYearLedgerForPlanRoot(deps, planRoot);
  if (
    !ledger ||
    ledger.ledgerId !== payload.ledgerId ||
    ledger.revision !== payload.expectedRevision
  ) {
    return allSupportedRecoveryUnavailableResponse(
      payload.financialYear,
      "all-supported-full-fiscal-year-recovery-stale",
      "Pack found newer saved all-supported recovery state. Refresh the panel and review the current target.",
      ledger,
      deps,
    );
  }
  if (ledger.zipPhase) {
    return allSupportedRecoveryUnavailableResponse(
      payload.financialYear,
      "all-supported-full-fiscal-year-target-retry-final-zip",
      "Pack cannot retry an individual target after it started final ZIP recovery.",
      ledger,
      deps,
    );
  }
  const target = allSupportedExplicitRetryTarget(ledger);
  if (
    !target ||
    target.financialYear !== payload.financialYear ||
    target.targetId !== payload.targetId
  ) {
    return allSupportedRecoveryUnavailableResponse(
      payload.financialYear,
      "all-supported-full-fiscal-year-target-retry-unavailable",
      "Pack cannot safely retry that saved target. Refresh the panel and review the current fiscal-year plan.",
      ledger,
      deps,
    );
  }

  const retryLedger = resetAllSupportedTargetForExplicitRetry(
    ledger,
    target,
    deps.now?.() ?? new Date(),
  );
  await persistAllSupportedFullFiscalYearLedger(deps, retryLedger);
  return runAllSupportedFullFiscalYearTargets(deps, retryLedger, runSinglePeriod);
}

async function continueSavedAllSupportedFullFiscalYearRun(
  deps: AllSupportedRunnerDeps,
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  runSinglePeriod: SinglePeriodRunner,
): Promise<PackMessageResponse> {
  if (ledger.zipPhase === "download-observing") {
    const downloadId = ledger.zipDownloadAttempt?.downloadId;
    const storageState = await readAllSupportedPlanLedgersStorageState(deps);
    if (
      storageState.state !== "valid" ||
      typeof downloadId !== "number" ||
      !Number.isSafeInteger(downloadId) ||
      downloadId < 0 ||
      allSupportedZipOwners(storageState.ledgers, downloadId).length !== 1
    ) {
      return allSupportedResponse(deps, ledger, finalZipReviewStep(ledger));
    }
    return reconcileAllSupportedFinalZip(deps, ledger);
  }
  if (ledger.zipPhase === "export-pending" || ledger.zipPhase === "export-retry-pending") {
    return exportAllSupportedFinalZip(deps, ledger);
  }
  if (ledger.zipPhase === "downloaded-cleanup-pending") {
    return finishAllSupportedFinalZip(deps, ledger, {
      ...completedTargetsStep(ledger),
      safeSignals: ["all-supported-full-fiscal-year-zip-downloaded"],
      safeMessage:
        "Pack confirmed the final fiscal-year ZIP and is retrying only its retained local cleanup.",
    });
  }
  if (ledger.zipPhase === "no-artifacts-cleanup-pending") {
    return finishAllSupportedFinalZip(deps, ledger, {
      ...completedTargetsStep(ledger),
      safeSignals: ["all-supported-full-fiscal-year-no-zip-artifacts"],
      safeMessage: "Pack found no ZIP artifacts and is retrying only its retained local cleanup.",
    });
  }
  if (ledger.zipPhase && isCleanedZipPhase(ledger.zipPhase)) {
    return allSupportedResponse(deps, ledger, completedRunStep(ledger));
  }
  // A saved final-download intent without an exact browser download ID is
  // deliberately not replayed. Neither a new portal run nor a replacement ZIP
  // can establish what happened to the first browser request.
  if (ledger.zipPhase) return allSupportedResponse(deps, ledger, finalZipReviewStep(ledger));
  if (ledger.status === "running") {
    const stale = isAllSupportedFullFiscalYearLedgerStale(ledger, deps.now?.() ?? new Date());
    if (!ledger.targets.some((target) => target.status === "running")) {
      return runAllSupportedFullFiscalYearTargets(deps, ledger, runSinglePeriod);
    }
    return allSupportedResponse(
      deps,
      ledger,
      stale ? interruptedRunStep(ledger) : activeRunStep(ledger),
    );
  }
  if (
    ledger.status === "partial" &&
    ledger.targets.every((target) =>
      ["pending", ...POSITIVE_TARGET_STATUSES].includes(target.status),
    )
  ) {
    return runAllSupportedFullFiscalYearTargets(deps, ledger, runSinglePeriod);
  }
  return allSupportedResponse(deps, ledger, unresolvedRunStep(ledger));
}

function resetAllSupportedTargetForExplicitRetry(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  target: FiledReturnsAllSupportedFullFiscalYearTarget,
  now: Date,
): FiledReturnsAllSupportedFullFiscalYearLedger {
  const status = canonicalDurableTargetStatus(scopeForTarget(target), "pending", [
    ...target.safeSignals,
    "full-fiscal-year-target-retry-approved",
  ]);
  return {
    ...ledger,
    revision: ledger.revision + 1,
    status: "partial",
    currentTargetId: target.targetId,
    updatedAt: now.toISOString(),
    targets: ledger.targets.map((candidate) =>
      candidate.targetId === target.targetId
        ? {
            ...candidate,
            status: "pending",
            ...status,
            updatedAt: now.toISOString(),
          }
        : candidate,
    ),
  };
}

function allSupportedRecoveryUnavailableResponse(
  financialYear: string,
  signal: string,
  safeMessage: string,
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger | null,
  deps: AllSupportedRunnerDeps,
): Promise<PackMessageResponse> {
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: `all-supported-full-fiscal-year:${financialYear}`,
    state: "user-action-required",
    safeSignals: [signal],
    safeMessage,
  };
  return ledger
    ? allSupportedResponse(deps, ledger, flowStep)
    : Promise.resolve({ ok: true, flowStep });
}

function persistedPeriodPlanLength(ledger: FiledReturnsAllSupportedFullFiscalYearLedger): number {
  const firstReturnType = ledger.targetPlan[0]?.returnType;
  return firstReturnType
    ? ledger.targetPlan.filter((target) => target.returnType === firstReturnType).length
    : 0;
}

function allSupportedZipOwners(
  ledgers: readonly FiledReturnsAllSupportedFullFiscalYearLedger[],
  downloadId: number,
): readonly FiledReturnsAllSupportedFullFiscalYearLedger[] {
  return ledgers.filter(
    (ledger) =>
      ledger.zipPhase === "download-observing" &&
      ledger.zipDownloadAttempt?.downloadId === downloadId,
  );
}

async function runAllSupportedFullFiscalYearTargets(
  deps: AllSupportedRunnerDeps,
  initialLedger: FiledReturnsAllSupportedFullFiscalYearLedger,
  runSinglePeriod: SinglePeriodRunner,
): Promise<PackMessageResponse> {
  let ledger = initialLedger;
  while (true) {
    const nextTarget = nextRunnableAllSupportedFullFiscalYearTarget(ledger);
    if (!nextTarget) return exportAllSupportedFinalZip(deps, ledger);

    const scope = scopeForTarget(nextTarget);
    if (!matchesConcreteArtifactSnapshot(nextTarget)) {
      const blocked = targetArtifactSnapshotMismatchStep(nextTarget);
      ledger = markAllSupportedFullFiscalYearTargetTerminal(
        ledger,
        nextTarget.targetId,
        "blocked",
        blocked,
        deps.now?.() ?? new Date(),
      );
      await persistAllSupportedFullFiscalYearLedger(deps, ledger);
      return allSupportedResponse(deps, ledger, blocked);
    }
    const previousSignals = nextTarget.safeSignals;
    let systemErrorPredecessor: SystemErrorPredecessor = "initial";
    ledger = markAllSupportedFullFiscalYearTargetRunning(
      ledger,
      nextTarget.targetId,
      deps.now?.() ?? new Date(),
    );
    await persistAllSupportedFullFiscalYearLedger(deps, ledger);

    const response = await runSinglePeriod(
      scope,
      {
        ...deps,
        onFlowStepObservation: (observation) => {
          deps.onFlowStepObservation?.(observation);
          if (!observation.portalSystemError) systemErrorPredecessor = observation.category;
        },
        persistTargetReview: false,
        stageCapturedDownloads: {
          bundleKind: "all-supported-full-fiscal-year",
          ledgerId: ledger.ledgerId,
        },
      },
      {
        onPortalTabSelected: async (tabId, tabSessionId) => {
          if (ledger.portalTabId !== undefined) return;
          const pinned: FiledReturnsAllSupportedFullFiscalYearLedger = {
            ...ledger,
            portalTabId: tabId,
            portalTabSessionId: tabSessionId,
            revision: ledger.revision + 1,
            updatedAt: (deps.now?.() ?? new Date()).toISOString(),
          };
          await persistAllSupportedFullFiscalYearLedger(deps, pinned);
          ledger = pinned;
        },
        persistSinglePeriodSummary: false,
        ...(ledger.portalTabId !== undefined && ledger.portalTabSessionId !== undefined
          ? {
              requiredPortalTabId: ledger.portalTabId,
              requiredPortalTabSessionId: ledger.portalTabSessionId,
            }
          : {}),
      },
    );

    if (!response.ok || !("flowStep" in response)) {
      const errorStep = targetErrorStep(nextTarget);
      ledger = markAllSupportedFullFiscalYearTargetTerminal(
        ledger,
        nextTarget.targetId,
        "failed",
        errorStep,
        deps.now?.() ?? new Date(),
      );
      await persistAllSupportedFullFiscalYearLedger(deps, ledger);
      return allSupportedResponse(deps, ledger, errorStep);
    }

    const flowStep = requireAllSupportedArtifactsStaged(
      scope,
      withSystemErrorPredecessor(
        mergeRetriedArtifactSignals(previousSignals, response.flowStep),
        systemErrorPredecessor,
      ),
    );
    const targetStatus = targetStatusFromFlowStep(flowStep);
    ledger = markAllSupportedFullFiscalYearTargetTerminal(
      ledger,
      nextTarget.targetId,
      targetStatus,
      flowStep,
      deps.now?.() ?? new Date(),
    );
    if (canCompleteAllSupportedFullFiscalYearLedger(ledger)) {
      ledger = withZipPhase(ledger, deps.now?.() ?? new Date(), "export-pending");
    }
    await persistAllSupportedFullFiscalYearLedger(deps, ledger);

    const persistedTarget = ledger.targets.find(
      (target) => target.targetId === nextTarget.targetId,
    );
    if (persistedTarget && POSITIVE_TARGET_STATUSES.has(persistedTarget.status)) continue;
    return allSupportedResponse(deps, ledger, flowStep);
  }
}

async function exportAllSupportedFinalZip(
  deps: AllSupportedRunnerDeps,
  initialLedger: FiledReturnsAllSupportedFullFiscalYearLedger,
): Promise<PackMessageResponse> {
  if (!canCompleteAllSupportedFullFiscalYearLedger(initialLedger)) {
    const blocked = withBlockedStatus(initialLedger, deps.now?.() ?? new Date());
    await persistAllSupportedFullFiscalYearLedger(deps, blocked);
    return allSupportedResponse(deps, blocked, unresolvedRunStep(blocked));
  }
  let ledger =
    initialLedger.zipPhase === "export-pending" || initialLedger.zipPhase === "export-retry-pending"
      ? initialLedger
      : withZipPhase(initialLedger, deps.now?.() ?? new Date(), "export-pending");
  await persistAllSupportedFullFiscalYearLedger(deps, ledger);

  const completeStep = completedTargetsStep(ledger);
  const zipStep = await exportAllSupportedFullFiscalYearZip(ledger, completeStep, {
    onBeforeDownloadStart: async (requestedAt) => {
      ledger = withZipIntent(ledger, requestedAt);
      await persistAllSupportedFullFiscalYearLedger(deps, ledger);
    },
    onDownloadStarted: async (downloadId) => {
      ledger = withZipObserving(ledger, deps.now?.() ?? new Date(), downloadId);
      await persistAllSupportedFullFiscalYearLedger(deps, ledger);
    },
  });
  return finishAllSupportedFinalZip(deps, ledger, zipStep);
}

async function reconcileAllSupportedFinalZip(
  deps: AllSupportedRunnerDeps,
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
): Promise<PackMessageResponse> {
  if (!canCompleteAllSupportedFullFiscalYearLedger(ledger)) {
    const blocked = withBlockedStatus(ledger, deps.now?.() ?? new Date());
    await persistAllSupportedFullFiscalYearLedger(deps, blocked);
    return allSupportedResponse(deps, blocked, unresolvedRunStep(blocked));
  }
  return finishAllSupportedFinalZip(
    deps,
    ledger,
    await reconcileAllSupportedFullFiscalYearZipDownload(ledger, completedTargetsStep(ledger)),
  );
}

async function finishAllSupportedFinalZip(
  deps: AllSupportedRunnerDeps,
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  zipStep: PortalFlowStepResult,
): Promise<PackMessageResponse> {
  if (zipStep.state !== "downloaded") {
    const next =
      zipStep.state === "download-unconfirmed"
        ? ledger
        : withZipPhase(ledger, deps.now?.() ?? new Date(), "export-retry-pending");
    await persistAllSupportedFullFiscalYearLedger(deps, next);
    return allSupportedResponse(deps, next, zipStep);
  }

  const noArtifacts = zipStep.safeSignals.includes(
    "all-supported-full-fiscal-year-no-zip-artifacts",
  );
  const clearSignals = await discardAllSupportedFullFiscalYearFiledReturnsZip(ledger.ledgerId);
  if (!clearSignals.includes("all-supported-full-fiscal-year-opfs-cleared")) {
    const pendingCleanup = withZipPhase(
      ledger,
      deps.now?.() ?? new Date(),
      noArtifacts ? "no-artifacts-cleanup-pending" : "downloaded-cleanup-pending",
    );
    await persistAllSupportedFullFiscalYearLedger(deps, pendingCleanup);
    return allSupportedResponse(deps, pendingCleanup, {
      ...zipStep,
      state: "blocked",
      safeSignals: [...zipStep.safeSignals, "all-supported-full-fiscal-year-local-cleanup-retry"],
      // The phase selection above already distinguishes these two paths; the message must too. On
      // the no-artifacts path nothing was exported, so claiming a confirmed ZIP sends the reader
      // looking in Downloads for a file that was never created.
      safeMessage: noArtifacts
        ? "No filed returns were available to save, and Pack could not clear its temporary local staging."
        : "Pack confirmed the final fiscal-year ZIP, but could not clear its temporary local staging.",
    });
  }

  const completed = withZipPhase(
    ledger,
    deps.now?.() ?? new Date(),
    noArtifacts ? "cleaned-without-export" : "cleaned-after-download",
  );
  await persistAllSupportedFullFiscalYearLedger(deps, completed);
  return allSupportedResponse(deps, completed, {
    ...zipStep,
    safeSignals: Array.from(
      new Set([
        ...zipStep.safeSignals,
        "all-supported-full-fiscal-year-complete",
        ...(noArtifacts ? [] : ["all-supported-full-fiscal-year-zip-downloaded"]),
      ]),
    ),
    safeMessage: zipStep.safeMessage,
  });
}

async function allSupportedResponse(
  deps: AllSupportedRunnerDeps,
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  flowStep: PortalFlowStepResult,
): Promise<PackMessageResponse> {
  const storageState = await readAllSupportedPlanLedgersStorageState(deps);
  return {
    ok: true,
    flowStep,
    allSupportedFullFiscalYearFlowSummary: toAllSupportedSummary(
      ledger,
      flowStep,
      storageState.state === "valid"
        ? allSupportedTerminalPlanRoots(storageState.ledgers)
        : allSupportedTerminalPlanRoots([ledger]),
    ),
  };
}

function toAllSupportedSummary(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  flowStep: PortalFlowStepResult,
  allTerminalPlanRoots = allSupportedTerminalPlanRoots([ledger]),
): FiledReturnsAllSupportedFullFiscalYearFlowSummary {
  const resumeMode = allSupportedResumeMode(ledger);
  const zipDelivered =
    ledger.zipPhase === "cleaned-after-download" ||
    ledger.zipPhase === "downloaded-cleanup-pending";
  const flowStepScope = scopeForTarget(
    ledger.targets.find((target) => target.targetId === ledger.currentTargetId) ??
      ledger.targets[0]!,
  );
  const explicitRetryTarget = allSupportedExplicitRetryTarget(ledger);
  return {
    resumeAvailable: resumeMode !== null,
    ...(resumeMode ? { resumeMode } : {}),
    ...(allTerminalPlanRoots.length > 0 ? { terminalPlanRoots: allTerminalPlanRoots } : {}),
    summaryIdentity: { ...ledger.planRoot },
    status: ledger.status,
    ...(ledger.status === "complete" ? { completedAt: ledger.updatedAt } : {}),
    updatedAt: ledger.updatedAt,
    completedTargetIds: ledger.targets
      .filter((target) => POSITIVE_TARGET_STATUSES.has(target.status))
      .map((target) => target.targetId),
    targetEvidence: ledger.targets.map((target) => ({
      targetId: target.targetId,
      financialYear: target.financialYear,
      period: target.period,
      returnType: target.returnType,
      artifactType: target.artifactType,
      outcome: targetOutcome(target, zipDelivered),
    })),
    totalTargets: ledger.targets.length,
    ledgerId: ledger.ledgerId,
    ...(explicitRetryTarget
      ? {
          allSupportedFullFiscalYearRecovery: {
            targetId: explicitRetryTarget.targetId,
            expectedRevision: ledger.revision,
            targetStatus: explicitRetryTarget.status,
          },
        }
      : {}),
    ...(ledger.currentTargetId ? { currentTargetId: ledger.currentTargetId } : {}),
    flowStepScope,
    flowStep,
  };
}

function targetOutcome(
  target: FiledReturnsAllSupportedFullFiscalYearTarget,
  zipDelivered: boolean,
): FiledReturnsAllSupportedFullFiscalYearFlowSummary["targetEvidence"][number]["outcome"] {
  if (target.status === "not-filed") return "not-filed";
  if (target.status === "downloaded") {
    if (!zipDelivered) return "captured";
    return target.safeSignals.some((signal) =>
      signal.startsWith("filed-return-artifact-unavailable:"),
    )
      ? "partly-saved"
      : "saved";
  }
  if (target.status === "pending") return "pending";
  if (target.status === "running") return "running";
  return "needs-review";
}

function scopeForTarget(
  target: Pick<
    FiledReturnsAllSupportedFullFiscalYearTarget,
    "artifactType" | "financialYear" | "period" | "returnType"
  >,
): FiledReturnsDownloadScope {
  return {
    financialYear: target.financialYear,
    period: target.period,
    returnType: target.returnType,
    artifactType: target.artifactType,
  };
}

function requireAllSupportedArtifactsStaged(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
): PortalFlowStepResult {
  if (flowStep.state !== "downloaded") return flowStep;
  const missing = concreteArtifactTypes(scope).filter(
    (artifactType) =>
      !flowStep.safeSignals.includes(
        `all-supported-full-fiscal-year-opfs-staged:${artifactType}`,
      ) && !flowStep.safeSignals.includes(`filed-return-artifact-unavailable:${artifactType}`),
  );
  if (missing.length === 0) return flowStep;
  return {
    ...flowStep,
    state: "blocked",
    safeSignals: [
      ...flowStep.safeSignals,
      "all-supported-full-fiscal-year-artifact-staging-incomplete",
      ...missing.map(
        (artifactType) => `all-supported-full-fiscal-year-artifact-not-staged:${artifactType}`,
      ),
    ],
    safeMessage:
      "Pack observed the portal download, but could not stage every required file for the all-returns fiscal-year ZIP.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Retry this return period so Pack can stage every selected file.",
      canResume: true,
    },
  };
}

function concreteArtifactTypes(scope: FiledReturnsDownloadScope) {
  return concreteFiledReturnsArtifactTypesForSelection(scope.returnType, scope.artifactType);
}

function matchesConcreteArtifactSnapshot(
  target: Pick<
    FiledReturnsAllSupportedFullFiscalYearTarget,
    "artifactType" | "concreteArtifactTypes" | "returnType"
  >,
): boolean {
  const current = concreteFiledReturnsArtifactTypesForSelection(
    target.returnType,
    target.artifactType,
  );
  return (
    current.length === target.concreteArtifactTypes.length &&
    current.every((artifactType, index) => artifactType === target.concreteArtifactTypes[index])
  );
}

function mergeRetriedArtifactSignals(
  previousSignals: readonly string[],
  flowStep: PortalFlowStepResult,
): PortalFlowStepResult {
  const retained = previousSignals.filter(
    (signal) =>
      /^filed-return-artifact-(?:downloaded|unavailable):(?:PDF|JSON|EXCEL)$/.test(signal) ||
      /^all-supported-full-fiscal-year-opfs-staged:(?:PDF|JSON|EXCEL)$/.test(signal),
  );
  return retained.length === 0
    ? flowStep
    : { ...flowStep, safeSignals: Array.from(new Set([...retained, ...flowStep.safeSignals])) };
}

function withSystemErrorPredecessor(
  flowStep: PortalFlowStepResult,
  predecessor: SystemErrorPredecessor,
): PortalFlowStepResult {
  if (
    !flowStep.safeSignals.includes("portal-system-error") ||
    flowStep.safeSignals.length >= MAX_DURABLE_FLOW_SIGNALS
  ) {
    return flowStep;
  }
  const signal = `all-supported-full-fiscal-year-system-error-preceded-by:${predecessor}`;
  return flowStep.safeSignals.includes(signal)
    ? flowStep
    : { ...flowStep, safeSignals: [...flowStep.safeSignals, signal] };
}

function withZipPhase(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  now: Date,
  zipPhase: AllSupportedFullFiscalYearZipPhase,
): FiledReturnsAllSupportedFullFiscalYearLedger {
  const next: FiledReturnsAllSupportedFullFiscalYearLedger = {
    ...ledger,
    revision: ledger.revision + 1,
    status: isCleanedZipPhase(zipPhase) ? "complete" : "blocked",
    updatedAt: now.toISOString(),
    zipPhase,
  };
  delete next.currentTargetId;
  if (zipPhase !== "download-intent-persisted" && zipPhase !== "download-observing") {
    delete next.zipDownloadAttempt;
  }
  return next;
}

function isCleanedZipPhase(zipPhase: AllSupportedFullFiscalYearZipPhase): boolean {
  return ["cleaned-after-download", "cleaned-without-export", "cleaned-legacy", "cleaned"].includes(
    zipPhase,
  );
}

function withZipIntent(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  requestedAt: Date,
): FiledReturnsAllSupportedFullFiscalYearLedger {
  const next = withZipPhase(ledger, requestedAt, "download-intent-persisted");
  next.zipDownloadAttempt = { requestedAt: requestedAt.toISOString() };
  return next;
}

function withZipObserving(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  now: Date,
  downloadId: number,
): FiledReturnsAllSupportedFullFiscalYearLedger {
  if (!Number.isSafeInteger(downloadId) || downloadId < 0) {
    throw new Error("Invalid all-supported full-year ZIP download ID checkpoint.");
  }
  const requestedAt = ledger.zipDownloadAttempt?.requestedAt;
  if (!requestedAt) throw new Error("Missing all-supported full-year ZIP intent checkpoint.");
  const next = withZipPhase(ledger, now, "download-observing");
  next.zipDownloadAttempt = { requestedAt, downloadId };
  return next;
}

function withBlockedStatus(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  now: Date,
): FiledReturnsAllSupportedFullFiscalYearLedger {
  const next = {
    ...ledger,
    revision: ledger.revision + 1,
    status: "blocked" as const,
    updatedAt: now.toISOString(),
  };
  delete next.currentTargetId;
  return next;
}

function completedTargetsStep(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(ledger.targets[0]!.returnType),
    state: "downloaded",
    safeSignals: ["full-fiscal-year-complete", "all-supported-full-fiscal-year-targets-complete"],
    safeMessage: `Pack finished checking the selected fiscal-year returns for FY ${ledger.planRoot.financialYear}.`,
  };
}

function completedRunStep(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
): PortalFlowStepResult {
  const noArtifacts = ledger.zipPhase === "cleaned-without-export";
  return {
    ...completedTargetsStep(ledger),
    safeSignals: [
      "full-fiscal-year-complete",
      "all-supported-full-fiscal-year-complete",
      ...(noArtifacts ? ["all-supported-full-fiscal-year-no-zip-artifacts"] : []),
      ...(ledger.zipPhase === "cleaned-after-download"
        ? ["all-supported-full-fiscal-year-zip-downloaded"]
        : []),
    ],
    safeMessage: `Pack completed the selected fiscal-year returns for FY ${ledger.planRoot.financialYear}.`,
  };
}

function activeRunStep(ledger: FiledReturnsAllSupportedFullFiscalYearLedger): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(ledger.targets[0]!.returnType),
    state: "ready",
    safeSignals: ["all-supported-full-fiscal-year-run-active"],
    safeMessage: "Pack is still checking the selected fiscal-year returns.",
  };
}

function interruptedRunStep(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(ledger.targets[0]!.returnType),
    state: "user-action-required",
    safeSignals: ["all-supported-full-fiscal-year-run-interrupted"],
    safeMessage:
      "Pack stopped before it could finish checking the selected fiscal-year returns. Resume only after reviewing the saved targets.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Review the saved targets before resuming this fiscal-year run.",
      canResume: true,
    },
  };
}

function unresolvedRunStep(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(ledger.targets[0]!.returnType),
    state: "blocked",
    safeSignals: ["all-supported-full-fiscal-year-run-needs-action"],
    safeMessage:
      "Pack retained the saved fiscal-year plan and will not repeat unresolved portal targets.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Resolve the saved fiscal-year plan before starting another one.",
      canResume: true,
    },
  };
}

function finalZipReviewStep(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
): PortalFlowStepResult {
  return {
    ...unresolvedRunStep(ledger),
    state: "download-unconfirmed",
    safeSignals: [
      "all-supported-full-fiscal-year-final-zip-manual-review",
      "all-supported-full-fiscal-year-opfs-retained",
    ],
    safeMessage:
      "Pack may have started the final fiscal-year ZIP before the previous run stopped. Check browser Downloads before taking another action.",
  };
}

function targetErrorStep(
  target: FiledReturnsAllSupportedFullFiscalYearTarget,
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(target.returnType),
    state: "blocked",
    safeSignals: [
      "all-supported-full-fiscal-year-target-error",
      "pack-error:CONTENT_SCRIPT_UNAVAILABLE",
    ],
    safeMessage: `Pack stopped while checking ${target.period}. The GST tab could not be reached safely.`,
  };
}

function targetArtifactSnapshotMismatchStep(
  target: FiledReturnsAllSupportedFullFiscalYearTarget,
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(target.returnType),
    state: "blocked",
    safeSignals: ["all-supported-full-fiscal-year-artifact-snapshot-mismatch"],
    safeMessage:
      "Pack retained the saved artifact selection, but the current extension cannot safely resume it after its supported formats changed.",
  };
}

function noEligiblePeriodsStep(financialYear: string): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: "gst-filed-returns-private-v0",
    state: "blocked",
    safeSignals: ["all-supported-full-fiscal-year-no-eligible-periods"],
    safeMessage: `No periods in FY ${financialYear} have reached Pack's conservative filing-eligibility cut-off yet.`,
  };
}

function expansionFailureStep(
  financialYear: string,
  reason: "no-full-fiscal-year-returns" | "return-has-no-offered-artifacts",
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: "gst-filed-returns-private-v0",
    state: "blocked",
    safeSignals: [`all-supported-full-fiscal-year-plan-${reason}`],
    safeMessage: `Pack could not create the selected fiscal-year plan for FY ${financialYear}.`,
  };
}
