import type {
  FiledReturnsDownloadTarget,
  FiledReturnsMainWorldCaptureRequest,
  PortalDownloadTriggerResult,
} from "../../core/contracts";
import {
  filedReturnsConcreteArtifactLabel,
  supportsFiledReturnsArtifactType,
} from "../../core/filed-returns-artifacts";
import { dismissKnownFiledReturnsSummaryModal } from "./filed-returns-dialogs";
import { detectFiledReturnDetailPage } from "./filed-returns-detail-page-guard";
import { resolveVisibleFiledReturnDownloadCandidates } from "./filed-returns-download-candidates";
import { verifyFiledReturnsDownloadTarget } from "./filed-returns-download-target";
import { waitForPostClickBlockedState } from "./filed-returns-post-click-blocked-state";
import {
  asPortalDownloadTriggerResult,
  detectFiledReturnsPortalAvailabilityIssue,
} from "./filed-returns-portal-availability";
import {
  filedReturnDescriptor,
  filedReturnScopedSignal,
  filedReturnScopeId,
} from "./filed-returns-return-descriptors";
import { prepareFiledReturnsPortalBlobDownloadCapture } from "./gstr2b-blob-capture";

export {
  findFiledGstr3bDownloadCandidateIndex,
  scoreFiledGstr3bDownloadCandidate,
} from "./filed-returns-download-candidates";

const DIALOG_SETTLE_DELAY_MS = 60;

export interface FiledReturnDownloadTriggerResult {
  downloadTrigger: PortalDownloadTriggerResult;
  mainWorldCaptureRequest?: FiledReturnsMainWorldCaptureRequest;
}

export async function triggerFiledGstr3bFiledPdfDownload(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
): Promise<PortalDownloadTriggerResult> {
  return triggerFiledReturnFiledPdfDownload(documentRef, target);
}

export async function triggerFiledReturnFiledPdfDownload(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
): Promise<PortalDownloadTriggerResult> {
  const result = await triggerFiledReturnDownload(documentRef, target);
  return result.downloadTrigger;
}

export async function triggerFiledReturnDownload(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
): Promise<FiledReturnDownloadTriggerResult> {
  const blockedState = detectBlockedPortalState(documentRef);
  if (blockedState) return { downloadTrigger: blockedState };

  const descriptor = filedReturnDescriptor(target.returnType);
  const scopeId = filedReturnScopeId(target.returnType);
  const artifactType = target.artifactType ?? "PDF";
  const artifactLabel = filedReturnsConcreteArtifactLabel(artifactType);
  if (!supportsFiledReturnsArtifactType(target.returnType, artifactType)) {
    return {
      downloadTrigger: {
        connectorId: "gst",
        scopeId,
        state: "blocked",
        safeSignals: [filedReturnScopedSignal(target.returnType, "artifact-unsupported")],
        safeMessage: `Pack does not support ${artifactLabel} downloads for filed ${descriptor.label}.`,
      },
    };
  }

  const safeSignals = await dismissKnownFiledReturnsSummaryModal(documentRef);
  const pageGuard = detectFiledReturnDetailPage(documentRef, target.returnType, artifactType);
  if (!pageGuard.isDetailPage) {
    return {
      downloadTrigger: {
        connectorId: "gst",
        scopeId,
        state: "candidate-not-found",
        safeSignals: [
          ...safeSignals,
          ...pageGuard.safeSignals,
          `not-filed-${descriptor.signalSlug}-detail-page`,
        ],
        safeMessage: `Pack will only click the filed ${descriptor.label} ${artifactLabel} download on the filed ${descriptor.label} detail page.`,
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          message: `Open a filed ${descriptor.label} result row so the filed ${descriptor.label} detail page is visible.`,
          canResume: true,
        },
      },
    };
  }
  const detailSignals = [...safeSignals, ...pageGuard.safeSignals];

  const targetGuard = verifyFiledReturnsDownloadTarget(documentRef, target, detailSignals);
  if (targetGuard) return { downloadTrigger: targetGuard };

  const viableCandidates = resolveVisibleFiledReturnDownloadCandidates(
    documentRef,
    target.returnType,
    artifactType,
  );

  if (viableCandidates.length !== 1) {
    return {
      downloadTrigger: {
        connectorId: "gst",
        scopeId,
        state: "candidate-not-found",
        safeSignals: [
          ...detailSignals,
          viableCandidates.length > 1
            ? filedReturnScopedSignal(target.returnType, "download-candidate-ambiguous")
            : filedReturnScopedSignal(target.returnType, "download-candidate-not-found"),
        ],
        safeMessage: `Pack could not find exactly one explicit filed ${descriptor.label} ${artifactLabel} download control on this GST page.`,
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          message: `Open the filed ${descriptor.label} detail page where the filed ${descriptor.label} ${artifactLabel} download button is visible.`,
          canResume: true,
        },
      },
    };
  }

  const viableCandidate = viableCandidates[0];
  if (!viableCandidate) {
    return {
      downloadTrigger: {
        connectorId: "gst",
        scopeId,
        state: "candidate-not-found",
        safeSignals: [
          ...detailSignals,
          filedReturnScopedSignal(target.returnType, "download-candidate-missing"),
        ],
        safeMessage: "Pack found an unstable filed-return download candidate. Run the check again.",
      },
    };
  }

  const { element, score } = viableCandidate;
  const clickedSignals = [
    ...detailSignals,
    "filed-return-download-clicked",
    filedReturnScopedSignal(target.returnType, "download-clicked"),
    ...score.safeSignals,
  ];

  const mainWorldCaptureRequest = tryCaptureFiledReturnBlobDownload(documentRef, target, {
    control: element,
    safeSignals: clickedSignals,
    scopeId,
  });
  if (mainWorldCaptureRequest) {
    return {
      mainWorldCaptureRequest,
      downloadTrigger: {
        connectorId: "gst",
        scopeId,
        state: "clicked",
        safeSignals: [
          ...clickedSignals,
          filedReturnScopedSignal(target.returnType, "portal-blob-download-captured"),
          filedReturnScopedSignal(target.returnType, "extension-download-requested"),
          `filed-return-artifact-clicked:${artifactType}`,
        ],
        safeMessage: `Pack captured the GST Portal's generated filed ${descriptor.label} ${artifactLabel} file and will save it through the browser downloads API.`,
      },
    };
  }

  activateElement(element);
  await delay(DIALOG_SETTLE_DELAY_MS);

  const postClickBlockedState = await waitForPostClickBlockedState(
    documentRef,
    target,
    clickedSignals,
  );
  if (postClickBlockedState) return { downloadTrigger: postClickBlockedState };

  return {
    downloadTrigger: {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: clickedSignals,
      safeMessage: `Pack clicked the GST portal's filed ${descriptor.label} ${artifactLabel} download control. Check the browser downloads shelf/folder for the file.`,
    },
  };
}

function tryCaptureFiledReturnBlobDownload(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
  context: {
    control: HTMLElement;
    safeSignals: string[];
    scopeId: string;
  },
): FiledReturnsMainWorldCaptureRequest | null {
  if (!supportsFiledReturnBlobCapture(target)) return null;
  const signalPrefix = filedReturnScopedSignal(target.returnType, "");
  const mainWorldCaptureRequest = prepareFiledReturnsPortalBlobDownloadCapture(
    documentRef,
    context.control,
    target.actionId,
    { signalPrefix: signalPrefix.endsWith("-") ? signalPrefix.slice(0, -1) : signalPrefix },
  );
  if (mainWorldCaptureRequest) return mainWorldCaptureRequest;
  context.safeSignals.push(filedReturnScopedSignal(target.returnType, "blob-capture-failed"));
  return null;
}

function supportsFiledReturnBlobCapture(target: FiledReturnsDownloadTarget): boolean {
  if (target.returnType === "GSTR-3B") return (target.artifactType ?? "PDF") === "PDF";
  return target.returnType === "GSTR-1";
}

function detectBlockedPortalState(documentRef: Document): PortalDownloadTriggerResult | null {
  const issue = detectFiledReturnsPortalAvailabilityIssue(documentRef);
  return issue ? asPortalDownloadTriggerResult(issue) : null;
}

function activateElement(element: HTMLElement) {
  element.scrollIntoView?.({ block: "center", inline: "center" });
  dispatchPointerSequence(element);
  element.click();
}

function dispatchPointerSequence(element: HTMLElement) {
  const MouseEventConstructor = element.ownerDocument.defaultView?.MouseEvent;
  if (!MouseEventConstructor) return;
  for (const type of ["pointerover", "mouseover", "mouseenter", "pointerdown", "mousedown"]) {
    element.dispatchEvent(
      new MouseEventConstructor(type, {
        bubbles: true,
        cancelable: true,
        view: element.ownerDocument.defaultView,
      }),
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
