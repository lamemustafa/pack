import {
  filedReturnsTargetOutcome,
  targetMissedAnArtifact,
} from "./filed-returns-full-fiscal-year-summary";
import { hasFullFiscalYearRefusalArtifactConflict } from "../connectors/gst/filed-returns-durable-signals";
import { canonicalDurableTargetStatus } from "../connectors/gst/filed-returns-durable-status";
import type {
  FiledReturnsAllSupportedFullFiscalYearFlowSummary,
  FiledReturnsAllSupportedFullFiscalYearTargetEvidence,
  FiledReturnsDownloadScope,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { isResolvedFullFiscalYearTargetStatus } from "../connectors/gst/filed-returns-contracts";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import { PACK_CLEAR_LOCAL_DATA_ACTION_LABEL } from "../core/recovery-actions";
import {
  allSupportedExplicitRetryTarget,
  allSupportedResumeMode,
  allSupportedStoppedRecovery,
  isAllSupportedFullFiscalYearLedgerStale,
  isAllSupportedRunInterrupted,
} from "./filed-returns-all-supported-full-fiscal-year-ledger";
import { isFiledReturnsRunLeaseLive } from "./filed-returns-active-run";
import {
  readAllSupportedPlanLedgersStorageState,
  savedPlanStorageStateStep,
  type AllSupportedPlanLedgersStorageState,
} from "./filed-returns-all-supported-full-fiscal-year-run-state";
import type {
  FiledReturnsAllSupportedFullFiscalYearLedger,
  FiledReturnsAllSupportedFullFiscalYearTarget,
} from "./filed-returns-all-supported-full-fiscal-year-validation";

export interface AllSupportedFullFiscalYearCurrentStateDeps {
  storageKeys: { allSupportedFullFiscalYearLedgerIndex?: string; activeRun?: string };
  now?: () => Date;
}

/**
 * Reads the separate root-indexed ledger without routing it through the atomic
 * period-only summary reader. A malformed index is deliberately not projected
 * as a successful or empty run; the start path will fail closed before it can
 * replace the record.
 */
export async function readCurrentAllSupportedFullFiscalYearFlowSummary(
  deps: AllSupportedFullFiscalYearCurrentStateDeps,
): Promise<FiledReturnsAllSupportedFullFiscalYearFlowSummary | null> {
  if (!deps.storageKeys.allSupportedFullFiscalYearLedgerIndex) return null;
  const state = await readAllSupportedPlanLedgersStorageState(deps);
  if (state.state !== "valid") return unresolvedSavedPlanSummary(state);
  const now = deps.now?.() ?? new Date();
  const ledger = currentLedger(state, now);
  if (!ledger) return null;
  // The root records no heartbeat while an atomic child is running, and a child may legitimately
  // take longer than the root's staleness window -- the content-message timeout alone is sixty
  // seconds. The run's own lease renews every ten, so a live lease is the evidence that the worker
  // is still there, and age alone is not.
  return toAllSupportedFullFiscalYearSummary(
    ledger,
    now,
    await isFiledReturnsRunLeaseLive(
      { storageKeys: deps.storageKeys.activeRun ? { activeRun: deps.storageKeys.activeRun } : {} },
      now,
    ),
    allSupportedTerminalPlanRoots(state.ledgers),
  );
}

/**
 * Projects an unverifiable saved plan as a blocked summary rather than as
 * nothing.
 *
 * Returning `null` here let `PACK_GET_FILED_RETURNS_FLOW_SUMMARY` fall through
 * to an unrelated atomic summary while every start was already being refused,
 * so the reader was shown a healthy surface for a state only the start path
 * would ever name.
 *
 * A malformed index has no plan root the summary can honestly claim to be
 * blocked on. It is still projected so this boundary cannot fall through to
 * an unrelated atomic summary, but it withholds `summaryIdentity` rather than
 * inventing a fiscal year. Options-level clearing remains the route out.
 */
function unresolvedSavedPlanSummary(
  state: Exclude<AllSupportedPlanLedgersStorageState, { state: "valid" }>,
): FiledReturnsAllSupportedFullFiscalYearFlowSummary | null {
  const planRoot =
    state.state === "provenance-unavailable"
      ? (state.planRoots[0] ?? null)
      : state.state === "removal-pending"
        ? state.planRoot
        : null;
  return {
    ...(planRoot ? { summaryIdentity: { ...planRoot } } : {}),
    status: "blocked",
    completedTargetIds: [],
    targetEvidence: [],
    totalTargets: 0,
    // No `ledgerId` and no recovery target: the panel's destructive and retry
    // controls each require one, so an unverifiable plan cannot be discarded,
    // resumed or retried from this projection by accident.
    resumeAvailable: false,
    flowStep: savedPlanStorageStateStep(planRoot?.financialYear, state.state),
  };
}

export function toAllSupportedFullFiscalYearSummary(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  now = new Date(),
  leaseIsLive = false,
  allTerminalPlanRoots = allSupportedTerminalPlanRoots([ledger]),
): FiledReturnsAllSupportedFullFiscalYearFlowSummary {
  // One derivation, consulted by every reader below. Previously the same condition was spelled out
  // inline for the `status` projection and for `summaryStep`, and the recovery guard did not
  // consult it at all -- so the summary reported the run as blocked while
  // `allSupportedExplicitRetryTarget` still treated its target as active and offered nothing.
  // That disagreement is #366: three exits, all gated on `running`, none reachable.
  const interrupted = isAllSupportedRunInterrupted(ledger, now, leaseIsLive);
  return projectAllSupportedFullFiscalYearSummary(
    ledger,
    summaryStep(ledger, interrupted),
    allTerminalPlanRoots,
    interrupted,
  );
}

/**
 * The one projection of a saved plan into the summary the panel renders.
 *
 * A polled read and every runner action both reach the panel through the same state slot, so they
 * must describe a plan identically; only the step differs, because an action reports the step it
 * just took. A second copy of this body in the runner drifted when #359 changed how a declined
 * format reads, and the same target then read as needing review straight after an action and as
 * not generated once the panel was reopened.
 */
export function projectAllSupportedFullFiscalYearSummary(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  flowStep: PortalFlowStepResult,
  allTerminalPlanRoots: ReturnType<typeof allSupportedTerminalPlanRoots>,
  interrupted: boolean,
): FiledReturnsAllSupportedFullFiscalYearFlowSummary {
  const zipDelivered =
    ledger.zipPhase === "cleaned-after-download" ||
    ledger.zipPhase === "downloaded-cleanup-pending";
  const flowStepScope = scopeForTarget(
    ledger.targets.find((target) => target.targetId === ledger.currentTargetId) ??
      ledger.targets[0]!,
  );
  const resumeMode = allSupportedResumeMode(ledger);
  const explicitRetryTarget = allSupportedExplicitRetryTarget(ledger, interrupted);
  const stopped = allSupportedStoppedRecovery(ledger);
  return {
    resumeAvailable: resumeMode !== null,
    ...(resumeMode ? { resumeMode } : {}),
    ...(allTerminalPlanRoots.length > 0 ? { terminalPlanRoots: allTerminalPlanRoots } : {}),
    summaryIdentity: { ...ledger.planRoot },
    status: interrupted ? "blocked" : ledger.status,
    ...(ledger.status === "complete" ? { completedAt: ledger.updatedAt } : {}),
    updatedAt: ledger.updatedAt,
    completedTargetIds: ledger.targets
      .filter((target) => isResolvedFullFiscalYearTargetStatus(target.status))
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
    ...(stopped?.discardable ? { recoveryWithheld: true as const } : {}),
    ...(ledger.currentTargetId ? { currentTargetId: ledger.currentTargetId } : {}),
    flowStepScope,
    flowStep: stopped ? stoppedRecoveryStep(flowStep, stopped) : flowStep,
  };
}

/**
 * The step for a plan only discarding can move (#376).
 *
 * The target's own durable message is shared with the single-return fiscal-year run and names that
 * run's control, which this surface does not render -- live, the reader was told to use a button
 * that was not there. Every reader of this summary gets the same replacement, because the
 * projection is the one place both the polled read and every action response pass through.
 *
 * Only a step that says nothing beyond "this plan is stopped on that target" is replaced. A step
 * carrying any other signal is reporting something more specific -- that the discard itself could
 * not clear staging, or that the plan changed under the reader -- and replacing it would tell the
 * reader to repeat the action that just failed.
 */
function stoppedRecoveryStep(
  flowStep: PortalFlowStepResult,
  { target, discardable }: NonNullable<ReturnType<typeof allSupportedStoppedRecovery>>,
): PortalFlowStepResult {
  const describesOnlyTheStop = flowStep.safeSignals.every(
    (signal) =>
      signal === "all-supported-full-fiscal-year-run-needs-action" ||
      target.safeSignals.includes(signal),
  );
  if (!describesOnlyTheStop) return flowStep;
  return {
    ...flowStep,
    safeMessage: discardable
      ? `Pack stopped at ${target.returnType} for ${target.period} and will not retry it in this saved plan. To continue, discard the saved plan and start this year again; files already captured for it are downloaded again.`
      : // No control is offered for this plan (#380), so the message is the only way out it has.
        `Pack stopped at ${target.returnType} for ${target.period} and will not retry it in this saved plan. The plan holds an answer you recorded, which running the year again would not bring back, so Pack will not discard it from here. To start this year again, use \u201c${PACK_CLEAR_LOCAL_DATA_ACTION_LABEL}\u201d in Pack's options.`,
  };
}

export function allSupportedTerminalPlanRoots(
  ledgers: readonly FiledReturnsAllSupportedFullFiscalYearLedger[],
): NonNullable<FiledReturnsAllSupportedFullFiscalYearFlowSummary["terminalPlanRoots"]> {
  return ledgers.flatMap((ledger) => {
    if (ledger.status !== "complete" && ledger.status !== "cancelled") return [];
    return [
      {
        financialYear: ledger.planRoot.financialYear,
        status: ledger.status,
        periodCount: new Set(ledger.targets.map((target) => target.period)).size,
        ledgerId: ledger.ledgerId,
      },
    ];
  });
}

function currentLedger(
  state: Extract<AllSupportedPlanLedgersStorageState, { state: "valid" }>,
  now: Date,
): FiledReturnsAllSupportedFullFiscalYearLedger | null {
  const candidates = [...state.ledgers].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
  return (
    candidates.find((ledger) => ledger.status !== "complete" && ledger.status !== "cancelled") ??
    candidates.find((ledger) => isAllSupportedFullFiscalYearLedgerStale(ledger, now)) ??
    candidates[0] ??
    null
  );
}

function summaryStep(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  interrupted: boolean,
): PortalFlowStepResult {
  const noArtifacts = ledger.zipPhase === "cleaned-without-export";
  const current =
    ledger.targets.find((target) => target.targetId === ledger.currentTargetId) ??
    ledger.targets[0]!;
  const connectorId = "gst" as const;
  const scopeId = filedReturnScopeId(current.returnType);
  // The status projection below already refuses to call a leased run interrupted; the message has
  // to agree, or the panel shows "running" while telling the reader Pack stopped.
  if (interrupted) {
    return {
      connectorId,
      scopeId,
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
  if (ledger.status === "running") {
    return {
      connectorId,
      scopeId,
      state: "ready",
      safeSignals: ["all-supported-full-fiscal-year-run-active"],
      safeMessage: "Pack is still checking the selected fiscal-year returns.",
    };
  }
  if (
    ledger.status === "complete" &&
    (ledger.zipPhase === "cleaned-after-download" || ledger.zipPhase === "cleaned-without-export")
  ) {
    return {
      connectorId,
      scopeId,
      state: "downloaded",
      safeSignals: [
        "all-supported-full-fiscal-year-complete",
        ...(noArtifacts
          ? ["all-supported-full-fiscal-year-no-zip-artifacts"]
          : ["all-supported-full-fiscal-year-zip-downloaded"]),
      ],
      safeMessage: noArtifacts
        ? "Pack completed the selected fiscal-year returns; no filed-return artifacts were available for a ZIP."
        : "Pack confirmed the final fiscal-year ZIP download.",
    };
  }
  if (isAmbiguousAllSupportedFinalZipHandoff(ledger)) return allSupportedFinalZipReviewStep(ledger);
  return unresolvedAllSupportedFullFiscalYearStep(ledger);
}

/**
 * Whether the plan's final ZIP may already have been handed to the browser without an exact
 * download ID Pack can check: an intent saved before the download started, a start with no
 * recorded ID, or an observation whose ID is missing. The polled summary and the runner both read
 * this, so one saved state gets one step.
 */
export function isAmbiguousAllSupportedFinalZipHandoff(
  ledger: Pick<FiledReturnsAllSupportedFullFiscalYearLedger, "zipPhase" | "zipDownloadAttempt">,
): boolean {
  if (ledger.zipPhase === "download-intent-persisted" || ledger.zipPhase === "download-started") {
    return true;
  }
  if (ledger.zipPhase !== "download-observing") return false;
  const downloadId = ledger.zipDownloadAttempt?.downloadId;
  return !(typeof downloadId === "number" && Number.isSafeInteger(downloadId) && downloadId >= 0);
}

/**
 * The one step for an all-returns plan whose final-ZIP handoff Pack cannot confirm. The ZIP may
 * already have been saved, so the plan offers no retry, resume or discard of its own; the step names
 * the exit that works. Both the polled summary and every action response use it -- two copies of
 * this step disagreed, and only one named the exit.
 */
export function allSupportedFinalZipReviewStep(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
): PortalFlowStepResult {
  const current =
    ledger.targets.find((target) => target.targetId === ledger.currentTargetId) ??
    ledger.targets[0]!;
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(current.returnType),
    state: "blocked",
    safeSignals: [
      "all-supported-full-fiscal-year-final-zip-manual-review",
      "all-supported-full-fiscal-year-opfs-retained",
    ],
    safeMessage: `Pack may have started the final fiscal-year ZIP before it stopped, so it will not build it again on its own. Check browser Downloads. If the ZIP is not there, open Pack's options and use \u201c${PACK_CLEAR_LOCAL_DATA_ACTION_LABEL}\u201d, which removes every saved plan, then start the year again.`,
  };
}

export function unresolvedAllSupportedFullFiscalYearStep(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
): PortalFlowStepResult {
  const target = ledger.targets.find((item) => item.targetId === ledger.currentTargetId);
  const conflict =
    target?.status === "blocked" &&
    hasFullFiscalYearRefusalArtifactConflict(target.returnType, target.safeSignals);
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId((target ?? ledger.targets[0]!).returnType),
    state: "blocked",
    safeSignals: ["all-supported-full-fiscal-year-run-needs-action"],
    safeMessage: conflict
      ? canonicalDurableTargetStatus(scopeForTarget(target), target.status, target.safeSignals)
          .safeMessage
      : "Pack retained the saved fiscal-year plan and will not repeat unresolved portal targets.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Resolve the saved fiscal-year plan before starting another one.",
      canResume: true,
    },
  };
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

function targetOutcome(
  target: FiledReturnsAllSupportedFullFiscalYearTarget,
  zipDelivered: boolean,
): FiledReturnsAllSupportedFullFiscalYearTargetEvidence["outcome"] {
  // The same exhaustive mapping the single-return fiscal-year path uses. Two hand-written copies
  // stood here, each ending in a `needs-review` default that silently absorbed any status they had
  // not been told about -- so a period the portal declined to generate was reported to the user as
  // needing review, in the one run type where it could not be. The shared record fails to compile
  // instead, which is the only reason the single-return path was already right.
  return filedReturnsTargetOutcome(
    target.status,
    zipDelivered,
    false,
    targetMissedAnArtifact(target),
  );
}
