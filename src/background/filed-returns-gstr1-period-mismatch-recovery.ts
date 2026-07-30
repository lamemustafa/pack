import type {
  FiledReturnsDownloadScope,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import {
  GSTR1_PERIOD_MISMATCH_RECOVERY_STOPPED_SIGNAL,
  isDurableFiledReturnsSignal,
} from "../connectors/gst/filed-returns-durable-signals";
import {
  gstr1PeriodMismatchRecoveryUserAction,
  incompleteGstr1PeriodMismatchRecoveryMessage,
} from "../connectors/gst/filed-returns-durable-status";
import { FILED_RETURNS_MONTHS } from "../connectors/gst/filed-returns-scope";
import type { PackMessageResponse } from "../connectors/gst/messages";
import { extractActivePeriod } from "./filed-returns-flow-runner-utils";

type FlowStepResponse = Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }>;

const MISMATCH_RECOVERY_SIGNALS = new Set([
  "filed-gstr1-scope-switch-navigation",
  "filed-gstr1-summary-period-mismatch",
]);

export const MAX_GSTR1_PERIOD_MISMATCH_RECOVERY_ATTEMPTS = 1;

export interface Gstr1PeriodMismatchRecovery {
  attempts: number;
  safeSignals: string[];
  visiblePeriod: string;
}

export function updateGstr1PeriodMismatchRecovery(
  current: Gstr1PeriodMismatchRecovery | null,
  scope: FiledReturnsDownloadScope,
  step: PortalFlowStepResult,
): Gstr1PeriodMismatchRecovery | null {
  if (scope.returnType !== "GSTR-1") return null;
  const visiblePeriod = extractActivePeriod(step);
  if (visiblePeriod === scope.period) return null;
  if (
    !visiblePeriod ||
    !FILED_RETURNS_MONTHS.includes(visiblePeriod as never) ||
    !step.safeSignals.some((signal) => MISMATCH_RECOVERY_SIGNALS.has(signal))
  ) {
    return current;
  }

  return {
    attempts: (current?.attempts ?? 0) + 1,
    visiblePeriod,
    safeSignals: uniqueSignals(
      (current?.safeSignals ?? []).filter((signal) => MISMATCH_RECOVERY_SIGNALS.has(signal)),
      step.safeSignals.filter((signal) => MISMATCH_RECOVERY_SIGNALS.has(signal)),
      [`filed-return-detail-period:${visiblePeriod}`],
    ),
  };
}

export function stopNonConvergingGstr1PeriodMismatchRecovery(
  scope: FiledReturnsDownloadScope,
  response: FlowStepResponse,
  recovery: Gstr1PeriodMismatchRecovery | null,
): FlowStepResponse | null {
  if (
    !recovery ||
    scope.returnType !== "GSTR-1" ||
    recovery.attempts <= MAX_GSTR1_PERIOD_MISMATCH_RECOVERY_ATTEMPTS
  ) {
    return null;
  }

  return explainIncompleteGstr1PeriodMismatchRecovery(
    scope,
    {
      ...response,
      flowStep: {
        ...response.flowStep,
        state: "user-action-required",
        safeSignals: uniqueSignals(response.flowStep.safeSignals, [
          GSTR1_PERIOD_MISMATCH_RECOVERY_STOPPED_SIGNAL,
        ]),
      },
    },
    recovery,
  );
}

export function pendingGstr1PeriodMismatchRecoveryStep(
  scope: FiledReturnsDownloadScope,
  step: PortalFlowStepResult,
  recovery: Gstr1PeriodMismatchRecovery | null,
): PortalFlowStepResult | null {
  if (!recovery || scope.returnType !== "GSTR-1") return null;
  if (step.state !== "user-action-required") return null;
  if (!step.safeSignals.includes("filed-returns-heading")) return null;
  if (step.safeSignals.some((signal) => ["gstr-1", "gstr-2b", "gstr-3b"].includes(signal))) {
    return null;
  }

  return {
    connectorId: "gst",
    scopeId: step.scopeId,
    state: "clicked",
    safeSignals: uniqueSignals(recovery.safeSignals, ["filed-returns-heading"]),
    safeMessage: `Pack left a filed GSTR-1 page showing ${recovery.visiblePeriod} and is waiting for the Returns Dashboard to load the requested ${scope.period} period.`,
  };
}

export function explainIncompleteGstr1PeriodMismatchRecovery(
  scope: FiledReturnsDownloadScope,
  response: FlowStepResponse,
  recovery: Gstr1PeriodMismatchRecovery | null,
): FlowStepResponse {
  if (!recovery || scope.returnType !== "GSTR-1") return response;

  const step = response.flowStep;
  if (hasHigherPriorityPortalAction(step)) return response;
  const prioritySignals = [
    ...(step.safeSignals.includes(GSTR1_PERIOD_MISMATCH_RECOVERY_STOPPED_SIGNAL)
      ? [GSTR1_PERIOD_MISMATCH_RECOVERY_STOPPED_SIGNAL]
      : []),
    ...(step.safeSignals.includes("flow-step-limit-reached") ? ["flow-step-limit-reached"] : []),
  ];
  return {
    ...response,
    flowStep: {
      ...step,
      safeSignals: uniqueSignals(
        recovery.safeSignals,
        prioritySignals,
        step.safeSignals.filter(isDurableFiledReturnsSignal),
      ).slice(0, 32),
      safeMessage: incompleteGstr1PeriodMismatchRecoveryMessage(scope, recovery.visiblePeriod),
      userAction: gstr1PeriodMismatchRecoveryUserAction(scope),
    },
  };
}

function hasHigherPriorityPortalAction(step: PortalFlowStepResult): boolean {
  if (step.state === "login-required") return true;
  const actionType = step.userAction?.type;
  if (!actionType || actionType === "NAVIGATE_TO_SUPPORTED_PAGE") return false;
  if (actionType !== "WAIT_FOR_PORTAL_AVAILABILITY") return true;
  return !step.safeSignals.some((signal) =>
    ["detail-ready-step-limit-reached", "flow-step-limit-reached"].includes(signal),
  );
}

function uniqueSignals(...groups: ReadonlyArray<readonly string[]>): string[] {
  return Array.from(new Set(groups.flat()));
}
