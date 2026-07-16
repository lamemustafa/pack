import type {
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  PortalFlowStepResult,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";

export function gstr2bDialogFreeUnsupportedStep({
  activePeriod,
  safeFailureSignals,
  scope,
  target,
  triggerStep,
}: {
  activePeriod: string | null;
  safeFailureSignals: readonly string[];
  scope: FiledReturnsDownloadScope;
  target: FiledReturnsDownloadTarget;
  triggerStep: PortalFlowStepResult;
}): PackMessageResponse | null {
  if (scope.returnType !== "GSTR-2B") return null;
  return {
    ok: true,
    flowStep: withFiledReturnsDownloadDiagnostic({
      attemptClass: "captured-portal-request",
      flowStep: {
        ...triggerStep,
        state: "unsupported-page",
        safeSignals: [
          ...triggerStep.safeSignals,
          "gstr2b-dialog-free-capture-unsupported",
          "gstr2b-blob-capture-failed",
          ...safeFailureSignals,
          ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
        ],
        safeMessage:
          "Pack could not complete a dialog-free GSTR-2B download in this Brave profile. Use the GST Portal download manually for this period; Pack will not keep retrying this path until a reviewed direct endpoint is added.",
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          message: "Use the visible GST Portal GSTR-2B download control manually for this period.",
          canResume: false,
        },
      },
      target,
    }),
  };
}
