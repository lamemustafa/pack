import type { PortalDownloadTriggerResult } from "../../core/contracts";
import type { FiledReturnsDownloadTarget } from "./filed-returns-contracts";
import {
  filedReturnsConcreteArtifactLabel,
  supportsFiledReturnsArtifactType,
} from "./filed-returns-artifacts";
import {
  dismissKnownFiledReturnsSummaryModal,
  isFiledReturnsSummaryModalDismissalBlocked,
} from "./filed-returns-dialogs";
import { detectFiledReturnDetailPage } from "./filed-returns-detail-page-guard";
import { activateElement } from "./filed-returns-dom";
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

export {
  findFiledGstr3bDownloadCandidateIndex,
  scoreFiledGstr3bDownloadCandidate,
} from "./filed-returns-download-candidates";

const DIALOG_SETTLE_DELAY_MS = 60;
export interface FiledReturnDownloadTriggerResult {
  downloadTrigger: PortalDownloadTriggerResult;
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
  const scopeId = filedReturnScopeId(target.returnType);
  const blockedState = detectBlockedPortalState(documentRef, scopeId);
  if (blockedState) return { downloadTrigger: blockedState };

  const descriptor = filedReturnDescriptor(target.returnType);
  const artifactType = target.artifactType ?? "PDF";
  const artifactLabel = filedReturnsConcreteArtifactLabel(artifactType, target.returnType);
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
  if (isFiledReturnsSummaryModalDismissalBlocked(safeSignals)) {
    return {
      downloadTrigger: {
        connectorId: "gst",
        scopeId,
        state: "blocked",
        safeSignals,
        safeMessage:
          "The GST Portal kept its GSTR-3B summary overlay open, so Pack did not start a download. Wait for the portal to settle, then retry.",
        userAction: {
          type: "WAIT_FOR_PORTAL_AVAILABILITY",
          message:
            "Wait for the GST Portal overlay to finish closing. If it remains open, use its Close control, then retry Pack.",
          canResume: true,
        },
      },
    };
  }
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

  if (target.returnType === "GSTR-3B") {
    return {
      downloadTrigger: {
        connectorId: "gst",
        scopeId,
        state: "blocked",
        safeSignals: [...detailSignals, "gstr3b-legacy-acquisition-retired"],
        safeMessage:
          "Pack acquires filed GSTR-3B artifacts through its verified artifact path, not the legacy portal-click path.",
      },
    };
  }

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

function detectBlockedPortalState(
  documentRef: Document,
  scopeId: string,
): PortalDownloadTriggerResult | null {
  const issue = detectFiledReturnsPortalAvailabilityIssue(documentRef, scopeId);
  return issue ? asPortalDownloadTriggerResult(issue) : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
