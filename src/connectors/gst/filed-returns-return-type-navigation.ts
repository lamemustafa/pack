import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "./filed-returns-contracts";
import { FILED_RETURN_ROUTE_MISMATCH_SIGNALS } from "./filed-returns-durable-signals";
import {
  navigateToFiledReturnsPage,
  navigateToReturnDashboardPage,
} from "./filed-returns-navigator";
import { detectFiledReturnRouteType } from "./filed-returns-observer-signals";
import { filedReturnDescriptor, filedReturnScopeId } from "./filed-returns-return-descriptors";
import { clearFiledReturnsSearchAttempt } from "./filed-returns-search-state";

export function returnFromMismatchedReturnPage(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  prefixSignals: readonly string[] = [],
): Promise<PortalFlowStepResult> | null {
  const visibleReturnType = detectFiledReturnRouteType({
    ...(documentRef.defaultView?.location.pathname
      ? { pathname: documentRef.defaultView.location.pathname }
      : {}),
  });
  if (!visibleReturnType || visibleReturnType === scope.returnType) return null;

  return navigateFromMismatchedReturnPage(documentRef, scope, visibleReturnType, prefixSignals);
}

async function navigateFromMismatchedReturnPage(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  visibleReturnType: FiledReturnsDownloadScope["returnType"],
  prefixSignals: readonly string[],
): Promise<PortalFlowStepResult> {
  clearFiledReturnsSearchAttempt(documentRef);
  const scopeId = filedReturnScopeId(scope.returnType);
  const requestedDescriptor = filedReturnDescriptor(scope.returnType);
  const navigation =
    requestedDescriptor.reselectionDestination === "filed-returns"
      ? await navigateToFiledReturnsPage(documentRef)
      : await navigateToReturnDashboardPage(documentRef, scopeId);
  const visibleLabel = filedReturnDescriptor(visibleReturnType).label;
  const requestedLabel = requestedDescriptor.label;

  return {
    connectorId: "gst",
    scopeId,
    state: navigation.state,
    safeSignals: [
      ...prefixSignals,
      FILED_RETURN_ROUTE_MISMATCH_SIGNALS[visibleReturnType],
      ...navigation.safeSignals,
    ],
    safeMessage:
      navigation.state === "clicked"
        ? `Pack left the filed ${visibleLabel} page to find the requested filed ${requestedLabel} return.`
        : `Pack found a filed ${visibleLabel} page while the requested return is ${requestedLabel}, but could not reach the portal page needed to continue. ${navigation.safeMessage}`,
    ...(navigation.userAction ? { userAction: navigation.userAction } : {}),
  };
}
