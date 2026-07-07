import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../core/contracts";
import {
  filedReturnDescriptor,
  filedReturnScopeId,
} from "../connectors/gst/filed-returns-return-descriptors";

export function toStepLimitReachedFlowStep(
  scope: FiledReturnsDownloadScope,
  lastStep: PortalFlowStepResult | null,
  options: {
    safeSignal: string;
    safeMessage: string;
    userActionMessage: string;
  },
): PortalFlowStepResult {
  return {
    connectorId: lastStep?.connectorId ?? "gst",
    scopeId: lastStep?.scopeId ?? filedReturnScopeId(scope.returnType),
    state: "user-action-required",
    safeSignals: Array.from(new Set([...(lastStep?.safeSignals ?? []), options.safeSignal])),
    safeMessage: options.safeMessage,
    userAction: {
      type: "WAIT_FOR_PORTAL_AVAILABILITY",
      message: options.userActionMessage,
      canResume: true,
    },
  };
}

export function searchStepLimitReachedMessage(scope: FiledReturnsDownloadScope): string {
  const descriptor = filedReturnDescriptor(scope.returnType);
  return `Pack selected the filed-return filters, but the GST Portal did not show a filed ${descriptor.label} row or download control before Pack's retry limit. If this period is not filed, no filed-return download is available. Otherwise wait for the portal results to finish loading, then start Pack again.`;
}

export function detailStepLimitReachedMessage(scope: FiledReturnsDownloadScope): string {
  const descriptor = filedReturnDescriptor(scope.returnType);
  return `Pack opened the filed ${descriptor.label} detail path, but the GST Portal did not show the requested download control before Pack's retry limit. Wait for the detail page to finish loading, then start Pack again.`;
}
