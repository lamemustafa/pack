import type { PortalDownloadTriggerResult } from "../../core/contracts";
import {
  dismissKnownFiledReturnsSummaryModal,
  type NavigationCandidateInput,
} from "./filed-returns-navigator";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
const DIALOG_SETTLE_DELAY_MS = 250;
const CLICKABLE_SELECTOR = ["a", "button", "[role='button']", "[ng-click]", "[data-ng-click]"].join(
  ",",
);
const BLOCKED_PORTAL_PATTERNS = [
  /request rejected/i,
  /access denied/i,
  /you are not authorized/i,
  /session (?:has )?expired/i,
  /please login again/i,
  /invalid session/i,
];

interface CandidateScore {
  score: number;
  safeSignals: string[];
}

export function scoreFiledGstr3bDownloadCandidate(
  candidate: NavigationCandidateInput,
): CandidateScore {
  const searchable = normaliseCandidateText([
    candidate.text,
    candidate.ariaLabel,
    candidate.title,
    candidate.href,
  ]);
  const safeSignals: string[] = [];
  let score = 0;
  const hasExplicitFiledDownload = /\bdownload\s+filed\s+gstr[\s-]?3b\b/.test(searchable);

  if (hasExplicitFiledDownload) {
    score += 160;
    safeSignals.push("text-download-filed-gstr3b");
  }
  if (/\bdownload\b/.test(searchable) && /\bfiled\b/.test(searchable)) {
    score += 50;
    safeSignals.push("text-download-filed");
  }
  if (/\bdownload\b/.test(searchable) && /\bgstr[\s-]?3b\b/.test(searchable)) {
    score += 40;
    safeSignals.push("text-download-gstr3b");
  }

  if (/\bsystem\s+generated\b/.test(searchable)) {
    score -= 220;
    safeSignals.push("excluded-system-generated-gstr3b");
  }
  if (
    /\b(save|submit|proceed|continue|file)\b/.test(searchable) ||
    (!hasExplicitFiledDownload && /\bclick here\b/.test(searchable))
  ) {
    score -= 160;
    safeSignals.push("excluded-filing-or-navigation-action");
  }
  if (!/\bdownload\b/.test(searchable)) {
    score -= 40;
    safeSignals.push("excluded-missing-download-term");
  }

  return { score, safeSignals };
}

export function findFiledGstr3bDownloadCandidateIndex(
  candidates: readonly NavigationCandidateInput[],
): number {
  let bestIndex = -1;
  let bestScore = 0;

  candidates.forEach((candidate, index) => {
    const { score } = scoreFiledGstr3bDownloadCandidate(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore >= 120 ? bestIndex : -1;
}

export async function triggerFiledGstr3bFiledPdfDownload(
  documentRef: Document,
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

  const elements = getClickableElements(documentRef).filter((element) => !isDisabled(element));
  const candidates = elements.map(toNavigationCandidateInput);
  const candidateIndex = findFiledGstr3bDownloadCandidateIndex(candidates);

  if (candidateIndex === -1) {
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "candidate-not-found",
      safeSignals: [...safeSignals, "filed-gstr3b-download-candidate-not-found"],
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

  const candidate = candidates[candidateIndex];
  const element = elements[candidateIndex];
  if (!candidate || !element) {
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "candidate-not-found",
      safeSignals: [...safeSignals, "filed-gstr3b-download-candidate-missing"],
      safeMessage: "Pack found an unstable filed-return download candidate. Run the check again.",
    };
  }

  const score = scoreFiledGstr3bDownloadCandidate(candidate);
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
  const windowRef = documentRef.defaultView;
  const path = windowRef?.location.pathname ?? "";
  const bodyText = documentRef.body?.innerText ?? documentRef.body?.textContent ?? "";
  const isBlockedPath = /\/services\/error|\/error\//i.test(path);
  const isBlockedText = BLOCKED_PORTAL_PATTERNS.some((pattern) => pattern.test(bodyText));
  if (!isBlockedPath && !isBlockedText) return null;

  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: /session|login/i.test(bodyText) ? "login-required" : "blocked",
    safeSignals: ["portal-blocked-or-session-expired"],
    safeMessage:
      "The GST portal appears to be on an access-denied or expired-session screen. Please return to an authenticated GST page before using Pack.",
    userAction: {
      type: "LOGIN",
      message: "Sign in to the GST portal, then reopen Pack on the authenticated page.",
      canResume: true,
    },
  };
}

function getClickableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll(CLICKABLE_SELECTOR)).filter((element) =>
    isHtmlElement(root, element),
  );
}

function toNavigationCandidateInput(element: HTMLElement): NavigationCandidateInput {
  const input: NavigationCandidateInput = {
    text: element.innerText || element.textContent || "",
  };
  const HTMLAnchorElementConstructor = element.ownerDocument.defaultView?.HTMLAnchorElement;
  const href =
    HTMLAnchorElementConstructor && element instanceof HTMLAnchorElementConstructor
      ? element.href
      : null;
  const ariaLabel = element.getAttribute("aria-label");
  const title = element.getAttribute("title");

  if (href) input.href = href;
  if (ariaLabel) input.ariaLabel = ariaLabel;
  if (title) input.title = title;

  return input;
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

function isDisabled(element: HTMLElement): boolean {
  return (
    element.getAttribute("disabled") !== null ||
    element.getAttribute("aria-disabled") === "true" ||
    element.classList.contains("disabled")
  );
}

function isHtmlElement(root: ParentNode, element: Element): element is HTMLElement {
  const documentRef = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  if (!documentRef) return false;
  const HTMLElementConstructor = documentRef.defaultView?.HTMLElement;
  return HTMLElementConstructor ? element instanceof HTMLElementConstructor : false;
}

function normaliseCandidateText(values: readonly (string | undefined)[]): string {
  return values.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
