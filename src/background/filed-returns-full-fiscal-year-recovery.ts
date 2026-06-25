import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTarget,
  FiledReturnsFullFiscalYearTargetStatus,
  PortalFlowStepResult,
} from "../core/contracts";
import type { FullFiscalYearTargetRecoveryPayload, PackMessageResponse } from "../core/messages";
import {
  isFullFiscalYearLedger,
  markFullFiscalYearTargetTerminal,
} from "./filed-returns-full-fiscal-year-ledger";
import { toFullFiscalYearSummary } from "./filed-returns-full-fiscal-year-summary";
import { clearFiledReturnsTargetReview } from "./filed-returns-target-review";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
const RECOVERABLE_TARGET_STATUSES = new Set<FiledReturnsFullFiscalYearTargetStatus>([
  "pending",
  "download-unconfirmed",
  "running",
  "blocked",
  "failed",
  "cancelled",
]);
const FINAL_SIDE_EFFECT_SIGNALS = new Set([
  "filed-gstr3b-download-clicked",
  "filed-gstr3b-download-trigger-ambiguous",
  "browser-download-created",
  "browser-download-size-unknown",
  "browser-download-not-observed",
]);

export interface FullFiscalYearTargetRecoveryDeps {
  storageKeys: {
    completion?: string;
    fullFiscalYearLedger: string;
    targetReview?: string;
  };
  now?: () => Date;
}

export type FullFiscalYearTargetRetryResult =
  | { ok: true; ledger: FiledReturnsFullFiscalYearLedger }
  | { ok: false; response: PackMessageResponse };

let recoveryCriticalSection = Promise.resolve();

export async function readFullFiscalYearTargetRecoveryScope(
  payload: FullFiscalYearTargetRecoveryPayload,
  deps: FullFiscalYearTargetRecoveryDeps,
): Promise<{ scope: FiledReturnsDownloadScope } | { response: PackMessageResponse }> {
  const checked = await readRecoverableFullFiscalYearTarget(payload, deps);
  if ("response" in checked) return { response: checked.response };
  return { scope: checked.ledger.scope };
}

export async function prepareFullFiscalYearTargetRetry(
  payload: FullFiscalYearTargetRecoveryPayload,
  deps: FullFiscalYearTargetRecoveryDeps,
): Promise<FullFiscalYearTargetRetryResult> {
  return runRecoveryCriticalSection(async () => {
    const checked = await readRecoverableFullFiscalYearTarget(payload, deps);
    if ("response" in checked) return { ok: false, response: checked.response };

    const now = deps.now?.() ?? new Date();
    const updatedLedger = resetFullFiscalYearTargetForRetry(checked.ledger, checked.target, now);
    await persistLedger(updatedLedger, deps);
    await clearLegacyTargetReview(checked.target, deps);
    return { ok: true, ledger: updatedLedger };
  });
}

export async function resolveFullFiscalYearTarget(
  payload: FullFiscalYearTargetRecoveryPayload,
  resolution: "manually-observed" | "cancelled",
  deps: FullFiscalYearTargetRecoveryDeps,
): Promise<PackMessageResponse> {
  return runRecoveryCriticalSection(async () => {
    const checked = await readRecoverableFullFiscalYearTarget(payload, deps);
    if ("response" in checked) return checked.response;

    if (resolution === "manually-observed" && !canResolveAsManuallyObserved(checked.target)) {
      return recoveryActionUnavailableResponse(
        "full-fiscal-year-manual-observation-unavailable",
        "Pack has no evidence that the final GST download click was attempted for this period. Retry or cancel this target instead.",
        checked.ledger,
      );
    }

    if (resolution === "cancelled") {
      return discardFullFiscalYearRun(checked.ledger, checked.target, deps);
    }

    const now = deps.now?.() ?? new Date();
    const flowStep = manuallyObservedStep(checked.target);
    const updatedLedger = markFullFiscalYearTargetTerminal(
      checked.ledger,
      checked.target.targetId,
      resolution,
      flowStep,
      now,
    );
    const flowSummary = toFullFiscalYearSummary(updatedLedger, flowStep);

    await persistLedger(updatedLedger, deps);
    await persistSummary(flowSummary, deps);
    await clearLegacyTargetReview(checked.target, deps);
    return { ok: true, flowStep, flowSummary };
  });
}

async function discardFullFiscalYearRun(
  ledger: FiledReturnsFullFiscalYearLedger,
  target: FiledReturnsFullFiscalYearTarget,
  deps: FullFiscalYearTargetRecoveryDeps,
): Promise<PackMessageResponse> {
  const now = deps.now?.() ?? new Date();
  const flowStep = discardedRunStep(target);
  const cancelledLedger = markFullFiscalYearTargetTerminal(
    ledger,
    target.targetId,
    "cancelled",
    flowStep,
    now,
  );
  const flowSummary = toFullFiscalYearSummary(cancelledLedger, flowStep);
  delete flowSummary.fullFiscalYearRecovery;

  await browser.storage.local.remove(deps.storageKeys.fullFiscalYearLedger);
  await persistSummary(flowSummary, deps);
  await clearLegacyTargetReview(target, deps);
  return { ok: true, flowStep, flowSummary };
}

async function runRecoveryCriticalSection<T>(action: () => Promise<T>): Promise<T> {
  const previous = recoveryCriticalSection;
  let release: () => void = () => undefined;
  recoveryCriticalSection = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

async function readRecoverableFullFiscalYearTarget(
  payload: FullFiscalYearTargetRecoveryPayload,
  deps: FullFiscalYearTargetRecoveryDeps,
): Promise<
  | {
      ledger: FiledReturnsFullFiscalYearLedger;
      target: FiledReturnsFullFiscalYearTarget;
    }
  | { response: PackMessageResponse }
> {
  const ledger = await readLedger(deps.storageKeys.fullFiscalYearLedger);
  if (!ledger) {
    return {
      response: recoveryActionUnavailableResponse(
        "full-fiscal-year-ledger-not-found",
        "Pack did not find a full fiscal-year recovery ledger. Refresh the GST page and start the run again.",
      ),
    };
  }

  if (ledger.ledgerId !== payload.ledgerId) {
    return {
      response: recoveryActionUnavailableResponse(
        "full-fiscal-year-ledger-mismatch",
        "Pack found a different full fiscal-year run. Refresh Pack before retrying.",
        ledger,
      ),
    };
  }

  if ((ledger.revision ?? 1) !== payload.expectedRevision) {
    return {
      response: recoveryActionUnavailableResponse(
        "full-fiscal-year-recovery-stale",
        "Pack found newer full fiscal-year recovery state. Refresh Pack and review the current action.",
        ledger,
      ),
    };
  }

  const target = ledger.targets.find((candidate) => candidate.targetId === payload.targetId);
  if (!target) {
    return {
      response: recoveryActionUnavailableResponse(
        "full-fiscal-year-target-not-found",
        "Pack did not find that full fiscal-year target. Refresh Pack before retrying.",
        ledger,
      ),
    };
  }

  if (!RECOVERABLE_TARGET_STATUSES.has(target.status)) {
    return {
      response: recoveryActionUnavailableResponse(
        "full-fiscal-year-target-not-recoverable",
        "Pack already has terminal state for this full fiscal-year target.",
        ledger,
      ),
    };
  }

  return { ledger, target };
}

function resetFullFiscalYearTargetForRetry(
  ledger: FiledReturnsFullFiscalYearLedger,
  target: FiledReturnsFullFiscalYearTarget,
  now: Date,
): FiledReturnsFullFiscalYearLedger {
  const timestamp = now.toISOString();
  return {
    ...ledger,
    revision: (ledger.revision ?? 1) + 1,
    status: "running",
    currentTargetId: target.targetId,
    updatedAt: timestamp,
    targets: ledger.targets.map((candidate) =>
      candidate.targetId === target.targetId
        ? {
            ...candidate,
            status: "pending",
            safeSignals: ["full-fiscal-year-target-retry-approved"],
            safeMessage: `Pack will retry ${candidate.period} in the full fiscal-year run.`,
            updatedAt: timestamp,
          }
        : candidate,
    ),
  };
}

function manuallyObservedStep(target: FiledReturnsFullFiscalYearTarget): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "user-action-required",
    safeSignals: ["filed-returns-target-manually-observed"],
    safeMessage: `Pack recorded ${target.period} as manually observed after user review of browser Downloads.`,
  };
}

function canResolveAsManuallyObserved(target: FiledReturnsFullFiscalYearTarget): boolean {
  return (
    target.status === "download-unconfirmed" ||
    target.safeSignals.some((signal) => FINAL_SIDE_EFFECT_SIGNALS.has(signal))
  );
}

function discardedRunStep(target: FiledReturnsFullFiscalYearTarget): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "user-action-required",
    safeSignals: ["full-fiscal-year-run-discarded"],
    safeMessage: `Pack discarded the saved full fiscal-year run before resuming ${target.period}.`,
  };
}

function recoveryActionUnavailableResponse(
  signal: string,
  safeMessage: string,
  ledger?: FiledReturnsFullFiscalYearLedger,
): PackMessageResponse {
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "user-action-required",
    safeSignals: [signal],
    safeMessage,
  };
  return {
    ok: true,
    flowStep,
    ...(ledger ? { flowSummary: toFullFiscalYearSummary(ledger, flowStep) } : {}),
  };
}

async function readLedger(key: string): Promise<FiledReturnsFullFiscalYearLedger | null> {
  const values = await browser.storage.local.get(key);
  const ledger = values[key];
  return isFullFiscalYearLedger(ledger) ? ledger : null;
}

async function persistLedger(
  ledger: FiledReturnsFullFiscalYearLedger,
  deps: FullFiscalYearTargetRecoveryDeps,
): Promise<void> {
  await browser.storage.local.set({ [deps.storageKeys.fullFiscalYearLedger]: ledger });
}

async function persistSummary(
  summary: FiledReturnsFlowSummary,
  deps: FullFiscalYearTargetRecoveryDeps,
): Promise<void> {
  const key = deps.storageKeys.completion;
  if (!key) return;
  await browser.storage.session.set({ [key]: summary });
}

async function clearLegacyTargetReview(
  target: FiledReturnsFullFiscalYearTarget,
  deps: FullFiscalYearTargetRecoveryDeps,
): Promise<void> {
  const scope: FiledReturnsDownloadScope = {
    financialYear: target.financialYear,
    period: target.period,
    returnType: target.returnType,
  };
  await clearFiledReturnsTargetReview(scope, deps);
}
