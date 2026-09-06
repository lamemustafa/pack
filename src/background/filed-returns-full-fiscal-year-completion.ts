import type { FiledReturnsFullFiscalYearLedger } from "../connectors/gst/filed-returns-contracts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import { getFiledReturnsFullFiscalYearPeriods } from "../connectors/gst/filed-returns-scope";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import {
  canCompleteFullFiscalYearLedger,
  hasCanonicalFullFiscalYearTargetPlan,
  reconcileFullFiscalYearLedgerTargets,
} from "./filed-returns-full-fiscal-year-ledger";
import {
  persistLedger,
  persistLedgerAndSummary,
  shouldPersistReconciledLedger,
} from "./filed-returns-full-fiscal-year-run-state";
import {
  blockedFullFiscalYearStep,
  toFullFiscalYearSummary,
} from "./filed-returns-full-fiscal-year-summary";

export async function prepareFullFiscalYearCompletion(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
  incompleteSignal:
    "full-fiscal-year-run-needs-action" | "full-fiscal-year-zip-target-state-invalid",
): Promise<
  | { ready: true; ledger: FiledReturnsFullFiscalYearLedger }
  | { ready: false; response: PackMessageResponse }
> {
  const plannedPeriods = getFiledReturnsFullFiscalYearPeriods(
    ledger.scope.financialYear,
    now,
    ledger.scope.returnType,
  );
  const reconciledLedger =
    plannedPeriods.length > 0
      ? reconcileFullFiscalYearLedgerTargets(ledger, now, plannedPeriods)
      : ledger;
  if (shouldPersistReconciledLedger(ledger, reconciledLedger)) {
    await persistLedger(deps, reconciledLedger);
  }
  if (!canCompleteFullFiscalYearLedger(reconciledLedger)) {
    const signal = hasCanonicalFullFiscalYearTargetPlan(reconciledLedger)
      ? incompleteSignal
      : "full-fiscal-year-target-plan-invalid";
    const step = blockedFullFiscalYearStep(signal, reconciledLedger);
    await persistLedgerAndSummary(deps, reconciledLedger, step);
    return {
      ready: false,
      response: {
        ok: true,
        flowStep: step,
        flowSummary: toFullFiscalYearSummary(reconciledLedger, step),
      },
    };
  }
  return { ready: true, ledger: reconciledLedger };
}
