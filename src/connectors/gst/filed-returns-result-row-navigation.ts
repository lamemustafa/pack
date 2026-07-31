import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "./filed-returns-contracts";
import { activateElement } from "./filed-returns-dom";
import { filedReturnsFilterSelectionMatchesScope } from "./filed-returns-filter-form";
import {
  findMatchingActionableFiledReturnRows,
  findMatchingFilterBoundGstr1Results,
  findMatchingFiledReturnRows,
} from "./filed-returns-result-rows";
import { filedReturnDescriptor, filedReturnScopeId } from "./filed-returns-return-descriptors";
import {
  consumeSettledFiledReturnsSearchForScope,
  gstr1ViewActivationStateForScope,
  markGstr1ViewActivationAttempted,
} from "./filed-returns-search-state";

interface ResolvedFiledReturnResultCandidates {
  actionableRows: ReturnType<typeof findMatchingActionableFiledReturnRows>;
  filterBoundResults: ReturnType<typeof findMatchingFilterBoundGstr1Results>;
  matchingRows: ReturnType<typeof findMatchingFiledReturnRows>;
}

export function openFiledReturnResultRow(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  searchSettled: boolean,
): PortalFlowStepResult {
  const descriptor = filedReturnDescriptor(scope.returnType);
  const scopeId = filedReturnScopeId(scope.returnType);
  const { actionableRows, filterBoundResults, matchingRows } = resolveResultCandidates(
    documentRef,
    scope,
    searchSettled,
  );

  if (matchingRows.length + filterBoundResults.length > 1) {
    return {
      connectorId: "gst",
      scopeId,
      state: "blocked",
      safeSignals: ["filed-return-result-row-ambiguous"],
      safeMessage: `Pack found more than one filed ${descriptor.label} result row for the requested period. Open the correct row manually, then start Pack again.`,
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: `Open the exact filed ${descriptor.label} row for the requested period.`,
        canResume: true,
      },
    };
  }

  if (matchingRows.length === 1 && actionableRows.length === 0) {
    return {
      connectorId: "gst",
      scopeId,
      state: "candidate-not-found",
      safeSignals: ["filed-return-result-view-not-found"],
      safeMessage: `Pack found the filed ${descriptor.label} result row, but not its explicit View control. Open that row manually, then start Pack again.`,
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: `Open the exact filed ${descriptor.label} row for the requested period.`,
        canResume: true,
      },
    };
  }

  const actionableResult = actionableRows[0] ?? filterBoundResults[0];
  if (actionableResult) {
    const gstr1ViewActivationState =
      scope.returnType === "GSTR-1"
        ? gstr1ViewActivationStateForScope(documentRef, scope)
        : "not-attempted";
    if (gstr1ViewActivationState === "navigation-pending") {
      return {
        connectorId: "gst",
        scopeId,
        state: "clicked",
        safeSignals: [
          "filed-gstr1-result-view-navigation-pending",
          "result-row-gstr1",
          ...(actionableResult.period
            ? [`filed-return-result-period:${actionableResult.period}`]
            : []),
        ],
        safeMessage: `Pack is waiting for the filed GSTR-1 ${scope.period} detail page after the exact View action.`,
      };
    }
    if (gstr1ViewActivationState === "expired") {
      return gstr1ViewUserActionRequired(
        scope,
        scopeId,
        actionableResult,
        actionableResult.filterBound,
        true,
      );
    }

    if (scope.returnType === "GSTR-1") {
      markGstr1ViewActivationAttempted(documentRef, scope);
    }
    const isFilterBoundResult = actionableResult.filterBound;
    if (searchSettled && !isFilterBoundResult) {
      consumeSettledFiledReturnsSearchForScope(documentRef, scope);
    }
    activateElement(actionableResult.view);
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: [
        "filed-return-result-view-clicked",
        `result-row-${descriptor.signalSlug}`,
        ...(scope.returnType === "GSTR-1" ? ["filed-gstr1-result-view-auto-clicked"] : []),
        ...(actionableResult.period
          ? [`filed-return-result-period:${actionableResult.period}`]
          : []),
        ...(isFilterBoundResult ? ["filed-return-filter-bound-result-view-clicked"] : []),
      ],
      safeMessage: `Pack opened the filed ${descriptor.label} result row.`,
    };
  }

  return {
    connectorId: "gst",
    scopeId,
    state: "candidate-not-found",
    safeSignals: ["filed-return-result-row-not-found"],
    safeMessage: `Pack could not find a filed ${descriptor.label} result row for the selected period. Check the portal results and start Pack again.`,
  };
}

function gstr1ViewUserActionRequired(
  scope: FiledReturnsDownloadScope,
  scopeId: string,
  actionableResult:
    | ResolvedFiledReturnResultCandidates["actionableRows"][number]
    | ResolvedFiledReturnResultCandidates["filterBoundResults"][number],
  filterBound: boolean,
  autoAttemptFailed: boolean,
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId,
    state: "user-action-required",
    safeSignals: [
      "filed-gstr1-result-view-user-action-required",
      ...(autoAttemptFailed ? ["filed-gstr1-result-view-auto-attempt-failed"] : []),
      "result-row-gstr1",
      ...(actionableResult.period ? [`filed-return-result-period:${actionableResult.period}`] : []),
      ...(filterBound ? ["filed-return-filter-bound-result-view-ready"] : []),
    ],
    safeMessage: autoAttemptFailed
      ? `Pack verified the filed GSTR-1 result for ${scope.period}, but the automatic View attempt did not open it. Click that row's exact View control in the GST Portal, then reopen Pack and retry this period.`
      : `Pack verified the filed GSTR-1 result for ${scope.period}. Click that row's exact View control in the GST Portal, then reopen Pack and retry this period.`,
    userAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: `Click View on the filed GSTR-1 result for ${scope.period}, then reopen Pack and retry this period.`,
      canResume: true,
    },
  };
}

function resolveResultCandidates(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  searchSettled: boolean,
): ResolvedFiledReturnResultCandidates {
  const allowFilterBoundScope =
    scope.returnType === "GSTR-1" &&
    searchSettled &&
    filedReturnsFilterSelectionMatchesScope(documentRef, scope);
  const matchOptions = { allowFilterBoundScope };
  return {
    matchingRows: findMatchingFiledReturnRows(documentRef, scope, matchOptions),
    actionableRows: findMatchingActionableFiledReturnRows(documentRef, scope, matchOptions),
    filterBoundResults: allowFilterBoundScope
      ? findMatchingFilterBoundGstr1Results(documentRef, scope)
      : [],
  };
}
