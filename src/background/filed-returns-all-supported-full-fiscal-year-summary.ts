import type {
  FiledReturnsAllSupportedFullFiscalYearFlowSummary,
  FiledReturnsAllSupportedFullFiscalYearTargetEvidence,
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearTargetStatus,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import {
  allSupportedExplicitRetryTarget,
  allSupportedResumeMode,
  isAllSupportedFullFiscalYearLedgerStale,
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

const POSITIVE_TARGET_STATUSES = new Set<FiledReturnsFullFiscalYearTargetStatus>([
  "downloaded",
  "not-filed",
]);

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
 * `malformed` is deliberately still `null`: its index is exactly the record
 * that failed to parse, so there is no plan root the summary could honestly
 * claim to be blocked on. Naming an invented year would be worse than naming
 * none. The start paths continue to fail closed with their own registered
 * signal, and Options-level clearing remains the route out.
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
  if (!planRoot) return null;
  return {
    summaryIdentity: { ...planRoot },
    status: "blocked",
    completedTargetIds: [],
    targetEvidence: [],
    totalTargets: 0,
    // No `ledgerId` and no recovery target: the panel's destructive and retry
    // controls each require one, so an unverifiable plan cannot be discarded,
    // resumed or retried from this projection by accident.
    resumeAvailable: false,
    flowStep: savedPlanStorageStateStep(planRoot.financialYear, state.state),
  };
}

export function toAllSupportedFullFiscalYearSummary(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  now = new Date(),
  leaseIsLive = false,
  allTerminalPlanRoots = allSupportedTerminalPlanRoots([ledger]),
): FiledReturnsAllSupportedFullFiscalYearFlowSummary {
  const flowStep = summaryStep(ledger, now, leaseIsLive);
  const zipDelivered =
    ledger.zipPhase === "cleaned-after-download" ||
    ledger.zipPhase === "downloaded-cleanup-pending";
  const flowStepScope = scopeForTarget(
    ledger.targets.find((target) => target.targetId === ledger.currentTargetId) ??
      ledger.targets[0]!,
  );
  const resumeMode = allSupportedResumeMode(ledger);
  const explicitRetryTarget = allSupportedExplicitRetryTarget(ledger);
  return {
    resumeAvailable: resumeMode !== null,
    ...(resumeMode ? { resumeMode } : {}),
    ...(allTerminalPlanRoots.length > 0 ? { terminalPlanRoots: allTerminalPlanRoots } : {}),
    summaryIdentity: { ...ledger.planRoot },
    status:
      isAllSupportedFullFiscalYearLedgerStale(ledger, now) &&
      ledger.status === "running" &&
      !leaseIsLive
        ? "blocked"
        : ledger.status,
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
  now: Date,
  leaseIsLive: boolean,
): PortalFlowStepResult {
  const noArtifacts = ledger.zipPhase === "cleaned-without-export";
  const current =
    ledger.targets.find((target) => target.targetId === ledger.currentTargetId) ??
    ledger.targets[0]!;
  const connectorId = "gst" as const;
  const scopeId = filedReturnScopeId(current.returnType);
  // The status projection below already refuses to call a leased run interrupted; the message has
  // to agree, or the panel shows "running" while telling the reader Pack stopped.
  if (
    ledger.status === "running" &&
    isAllSupportedFullFiscalYearLedgerStale(ledger, now) &&
    !leaseIsLive
  ) {
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
  return {
    connectorId,
    scopeId,
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
