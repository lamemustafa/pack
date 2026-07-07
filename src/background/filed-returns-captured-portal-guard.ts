import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  PortalFlowStepResult,
} from "../core/contracts";
import type { FiledReturnsConcreteArtifactType } from "../core/filed-returns-artifacts";
import type { PackMessageResponse } from "../core/messages";
import { expectedDownloadForScope } from "./filed-returns-download-expectations";
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";

export function gstr2bDialogFreeUnsupportedStep({
  activePeriod,
  nativeSuppressionSignals,
  scope,
  target,
  triggerStep,
}: {
  activePeriod: string | null;
  nativeSuppressionSignals: readonly string[];
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
          ...nativeSuppressionSignals,
          ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
        ],
        safeMessage:
          "Pack could not complete a dialog-free GSTR-2B download in this Brave profile. Use the GST Portal download manually for this period; Pack will not keep retrying this path until a reviewed direct endpoint is added.",
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          message:
            "Use the visible GST Portal GSTR-2B download control manually for this period.",
          canResume: false,
        },
      },
      target,
    }),
  };
}

export function suppressNativePortalDownloadsDuringCapture(
  scope: FiledReturnsDownloadScope,
  artifactType: FiledReturnsConcreteArtifactType,
): { safeSignals: () => string[]; stop: () => void } {
  const event = browser.downloads.onCreated as
    | {
        addListener?: (listener: (item: { id?: number; url?: string }) => void) => void;
        removeListener?: (listener: (item: { id?: number; url?: string }) => void) => void;
      }
    | undefined;
  const cancel = (browser.downloads as { cancel?: (downloadId: number) => Promise<void> }).cancel;
  if (!event?.addListener || !event.removeListener || !cancel) {
    return { safeSignals: () => [], stop: () => undefined };
  }

  const expectedOrigins = new Set(expectedDownloadForScope(scope, artifactType).expectedOrigins);
  let cancelledCount = 0;
  const listener = (item: { id?: number; url?: string }) => {
    if (typeof item.id !== "number" || !matchesExpectedOrigin(item.url, expectedOrigins)) return;
    cancelledCount += 1;
    void cancel.call(browser.downloads, item.id).catch(() => undefined);
  };
  event.addListener(listener);
  return {
    safeSignals: () =>
      cancelledCount > 0
        ? [
            "captured-portal-native-download-cancelled",
            `captured-portal-native-download-cancelled-count:${cancelledCount}`,
          ]
        : [],
    stop: () => event.removeListener?.(listener),
  };
}

function matchesExpectedOrigin(url: string | undefined, expectedOrigins: ReadonlySet<string>) {
  if (!url) return false;
  try {
    return expectedOrigins.has(new URL(url).origin);
  } catch {
    return false;
  }
}
