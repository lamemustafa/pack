import type {
  FiledReturnsDownloadScope,
  FiledReturnsTargetBoundViewPoint,
  PortalFlowStepResult,
} from "../../core/contracts";
import { activateElement, delay } from "./filed-returns-dom";
import { filedReturnsFilterSelectionMatchesScope } from "./filed-returns-filter-form";
import {
  findMatchingActionableFiledReturnRows,
  findMatchingFilterBoundGstr1Results,
  findMatchingFiledReturnRows,
} from "./filed-returns-result-rows";
import { filedReturnDescriptor, filedReturnScopeId } from "./filed-returns-return-descriptors";
import { hasSettledFiledReturnsSearchForScope } from "./filed-returns-search-state";

interface ResolvedFiledReturnResultCandidates {
  actionableRows: ReturnType<typeof findMatchingActionableFiledReturnRows>;
  filterBoundResults: ReturnType<typeof findMatchingFilterBoundGstr1Results>;
  matchingRows: ReturnType<typeof findMatchingFiledReturnRows>;
}

export type Gstr1ViewPointResolution =
  | { ok: true; point: FiledReturnsTargetBoundViewPoint }
  | { ok: false; flowStep: PortalFlowStepResult };

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
    if (scope.returnType === "GSTR-1") {
      return {
        connectorId: "gst",
        scopeId,
        state: "user-action-required",
        safeSignals: [
          "filed-gstr1-result-view-user-action-required",
          "result-row-gstr1",
          ...(actionableResult.period
            ? [`filed-return-result-period:${actionableResult.period}`]
            : []),
          ...(filterBoundResults[0] === actionableResult
            ? ["filed-return-filter-bound-result-view-ready"]
            : []),
        ],
        safeMessage: `Pack verified the filed GSTR-1 result for ${scope.period}. Click that row's exact View control in the GST Portal, then reopen Pack and retry this period.`,
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          message: `Click View on the filed GSTR-1 result for ${scope.period}, then reopen Pack and retry this period.`,
          canResume: true,
        },
      };
    }

    activateElement(actionableResult.view);
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: [
        "filed-return-result-view-clicked",
        `result-row-${descriptor.signalSlug}`,
        ...(actionableResult.period
          ? [`filed-return-result-period:${actionableResult.period}`]
          : []),
        ...(filterBoundResults[0] === actionableResult
          ? ["filed-return-filter-bound-result-view-clicked"]
          : []),
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

export async function resolveGstr1FiledReturnViewPoint(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): Promise<Gstr1ViewPointResolution> {
  const searchSettled = hasSettledFiledReturnsSearchForScope(documentRef, scope);
  const fallback = openFiledReturnResultRow(documentRef, scope, searchSettled);
  if (
    scope.returnType !== "GSTR-1" ||
    !fallback.safeSignals.includes("filed-gstr1-result-view-user-action-required")
  ) {
    return { ok: false, flowStep: fallback };
  }

  const { actionableRows, filterBoundResults, matchingRows } = resolveResultCandidates(
    documentRef,
    scope,
    searchSettled,
  );
  if (matchingRows.length + filterBoundResults.length !== 1) {
    return { ok: false, flowStep: fallback };
  }
  const view = actionableRows[0]?.view ?? filterBoundResults[0]?.view;
  if (!view) return { ok: false, flowStep: fallback };

  view.scrollIntoView?.({ block: "center", inline: "center" });
  await delay(50);
  const rect = view.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const windowRef = documentRef.defaultView;
  const hitTarget = documentRef.elementFromPoint?.(x, y) ?? null;
  if (
    !windowRef ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    x < 0 ||
    y < 0 ||
    x >= windowRef.innerWidth ||
    y >= windowRef.innerHeight ||
    (hitTarget !== view && !view.contains(hitTarget))
  ) {
    return {
      ok: false,
      flowStep: {
        ...fallback,
        safeSignals: [...fallback.safeSignals, "filed-gstr1-result-view-point-unavailable"],
        safeMessage:
          "Pack verified the filed GSTR-1 result, but its exact View control is not safely clickable yet. Keep the result visible and retry this period.",
      },
    };
  }

  return { ok: true, point: { x, y } };
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
      ? findMatchingFilterBoundGstr1Results(documentRef)
      : [],
  };
}
