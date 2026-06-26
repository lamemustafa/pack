import type { FiledReturnsDownloadTarget, PortalDownloadTriggerResult } from "../../core/contracts";
import { resolveVisibleFiledGstr3bDownloadCandidates } from "./filed-returns-download-candidates";
import { verifyFiledReturnsDownloadTarget } from "./filed-returns-download-target";
import { dismissKnownFiledReturnsSummaryModal } from "./filed-returns-navigator";
import {
  asPortalDownloadTriggerResult,
  detectFiledReturnsPortalAvailabilityIssue,
} from "./filed-returns-portal-availability";

export {
  findFiledGstr3bDownloadCandidateIndex,
  scoreFiledGstr3bDownloadCandidate,
} from "./filed-returns-download-candidates";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
const DIALOG_SETTLE_DELAY_MS = 250;
export async function triggerFiledGstr3bFiledPdfDownload(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
): Promise<PortalDownloadTriggerResult> {
  const blockedState = detectBlockedPortalState(documentRef);
  if (blockedState) return blockedState;

  const safeSignals = await dismissKnownFiledReturnsSummaryModal(documentRef);
  const pageGuard = detectFiledGstr3bDetailPage(documentRef);
  if (!pageGuard.isDetailPage) {
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "candidate-not-found",
      safeSignals: [...safeSignals, ...pageGuard.safeSignals, "not-filed-gstr3b-detail-page"],
      safeMessage: "Pack will only click DOWNLOAD FILED GSTR-3B on the filed GSTR-3B detail page.",
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: "Open a filed GSTR-3B result row so the filed GSTR-3B detail page is visible.",
        canResume: true,
      },
    };
  }

  const targetGuard = verifyFiledReturnsDownloadTarget(documentRef, target, safeSignals);
  if (targetGuard) return targetGuard;

  const viableCandidates = resolveVisibleFiledGstr3bDownloadCandidates(documentRef);

  if (viableCandidates.length !== 1) {
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "candidate-not-found",
      safeSignals: [
        ...safeSignals,
        viableCandidates.length > 1
          ? "filed-gstr3b-download-candidate-ambiguous"
          : "filed-gstr3b-download-candidate-not-found",
      ],
      safeMessage:
        "Pack could not find the explicit DOWNLOAD FILED GSTR-3B control on this GST page.",
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message:
          "Open the filed GSTR-3B detail page where the DOWNLOAD FILED GSTR-3B button is visible.",
        canResume: true,
      },
    };
  }

  const viableCandidate = viableCandidates[0];
  if (!viableCandidate) {
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "candidate-not-found",
      safeSignals: [...safeSignals, "filed-gstr3b-download-candidate-missing"],
      safeMessage: "Pack found an unstable filed-return download candidate. Run the check again.",
    };
  }

  const { element, score } = viableCandidate;

  activateElement(element);
  await delay(DIALOG_SETTLE_DELAY_MS);

  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "clicked",
    safeSignals: [...safeSignals, "filed-gstr3b-download-clicked", ...score.safeSignals],
    safeMessage:
      "Pack clicked the GST portal's DOWNLOAD FILED GSTR-3B control. Check the browser downloads shelf/folder for the PDF.",
  };
}

function detectFiledGstr3bDetailPage(documentRef: Document): {
  isDetailPage: boolean;
  safeSignals: string[];
} {
  const path = documentRef.defaultView?.location.pathname ?? "";
  const text = documentRef.body?.innerText ?? documentRef.body?.textContent ?? "";
  const normalised = text.replace(/\s+/g, " ").trim().toLowerCase();
  const safeSignals: string[] = [];

  if (/\/returns\/auth\/gstr3b$/i.test(path)) safeSignals.push("gstr-3b-detail-route");
  if (/gstr[\s-]?3b\s*-\s*monthly\s+return/.test(normalised)) {
    safeSignals.push("gstr-3b-monthly-return-heading");
  }
  if (/\bstatus\s*-\s*filed\b|\bstatus\s+filed\b/.test(normalised)) {
    safeSignals.push("status-filed");
  }
  if (/\bdownload\s+filed\s+gstr[\s-]?3b\b/.test(normalised)) {
    safeSignals.push("download-filed-gstr3b-visible");
  }

  return {
    isDetailPage:
      safeSignals.includes("download-filed-gstr3b-visible") &&
      (safeSignals.includes("gstr-3b-detail-route") ||
        (safeSignals.includes("gstr-3b-monthly-return-heading") &&
          safeSignals.includes("status-filed"))),
    safeSignals,
  };
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
