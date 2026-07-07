import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import type { FiledReturnsDownloadScope, FiledReturnsDownloadTarget } from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";

export function capturedDownloadRejected(
  scope: FiledReturnsDownloadScope,
  target: FiledReturnsDownloadTarget,
  safeSignal: string,
  safeMessage: string,
): PackMessageResponse {
  return {
    ok: true,
    flowStep: withFiledReturnsDownloadDiagnostic({
      attemptClass: "captured-portal-request",
      flowStep: {
        connectorId: "gst",
        scopeId: filedReturnScopeId(scope.returnType),
        state: "blocked",
        safeSignals: [safeSignal],
        safeMessage,
      },
      target,
    }),
  };
}
