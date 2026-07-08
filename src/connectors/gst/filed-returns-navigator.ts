import type { PortalNavigationResult } from "../../core/contracts";
import {
  collectSafeNavigationDiagnostics,
  findDialogDismissalCandidateIndex,
  findFiledReturnsNavigationCandidateIndex,
  findReturnDashboardCandidateIndex,
  normaliseCandidateText,
  scoreDialogDismissalCandidate,
  scoreFiledReturnsNavigationCandidate,
  scoreFiledReturnsSummaryModalDismissalCandidate,
  scoreReturnDashboardNavigationCandidate,
  type NavigationCandidateInput,
  type NavigationCandidateScore,
} from "./filed-returns-navigation-candidates";
import { detectFiledReturnsPortalAvailabilityIssue } from "./filed-returns-portal-availability";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
const MENU_REVEAL_DELAY_MS = 350;
const DIALOG_SETTLE_DELAY_MS = 100;
const DIALOG_SETTLE_POLL_MS = 20;
const MAX_DIALOG_DISMISSALS = 4;
const CLICKABLE_SELECTOR = [
  "a",
  "button",
  "[role='button']",
  "[ng-click]",
  "[data-ng-click]",
  "[ng-mouseenter]",
  "[data-ng-mouseenter]",
  "[data-dismiss='modal']",
].join(",");
const MODAL_SELECTOR = ".modal.in, .modal.show, .modal-open .modal, [role='dialog']";
const SUMMARY_MODAL_PATTERN = /system generated summary for gstr[\s-]?3b/i;
const SAFE_POST_LOGIN_DIALOG_PATTERNS = [
  /would you like to authenticate aadhaar or upload e-?kyc documents/i,
  /dashboard\s*>\s*my profile\s*>\s*aadhaar authentication status/i,
  /gst system is collecting metadata/i,
  /furnish the bank account details/i,
  /(?:gta\s+)?annexure\s+v/i,
  /goods transport agency\s+annexure/i,
  /logged in session will expire[\s\S]*click continue to extend your session/i,
];

export async function navigateToFiledReturnsPage(
  documentRef: Document,
): Promise<PortalNavigationResult> {
  const blockedState = detectBlockedPortalState(documentRef);
  if (blockedState) return blockedState;

  const safeSignals: string[] = [];
  const dismissedDialogs = await dismissSafePostLoginDialogs(documentRef);
  safeSignals.push(...dismissedDialogs);

  const firstPass = clickBestFiledReturnsCandidate(documentRef, "initial-scan", safeSignals);
  if (firstPass) return firstPass;

  revealMenuCandidate(documentRef, isServicesMenuCandidate);
  await delay(MENU_REVEAL_DELAY_MS);
  safeSignals.push(...(await dismissSafePostLoginDialogs(documentRef)));

  const afterServices = clickBestFiledReturnsCandidate(
    documentRef,
    "after-services-menu",
    safeSignals,
  );
  if (afterServices) return afterServices;

  revealMenuCandidate(documentRef, isReturnsMenuCandidate);
  await delay(MENU_REVEAL_DELAY_MS);
  safeSignals.push(...(await dismissSafePostLoginDialogs(documentRef)));

  const afterReturns = clickBestFiledReturnsCandidate(
    documentRef,
    "after-returns-menu",
    safeSignals,
  );
  if (afterReturns) return afterReturns;

  const hiddenMenuPass = clickBestHiddenFiledReturnsMenuCandidate(
    documentRef,
    "hidden-services-returns-menu",
    safeSignals,
  );
  if (hiddenMenuPass) return hiddenMenuPass;

  if (!isReturnDashboardRoute(documentRef)) {
    const dashboardPass = clickBestReturnDashboardCandidate(
      documentRef,
      "after-filed-returns-menu",
      safeSignals,
    );
    if (dashboardPass) return dashboardPass;
  }

  const diagnostics = collectSafeNavigationDiagnostics(
    getClickableElements(documentRef).map(toNavigationCandidateInput),
  );

  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "candidate-not-found",
    safeSignals: [
      ...safeSignals,
      "no-filed-returns-candidate",
      ...diagnostics.map((label) => `visible-nav:${label.toLowerCase().replace(/\s+/g, "-")}`),
    ],
    safeMessage:
      "Pack could not find the portal's View Filed Returns entry yet. Use GST Portal navigation only: Services > Returns > View Filed Returns, then run Pack again.",
    userAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: "Open Services > Returns > View Filed Returns in the GST portal.",
      canResume: true,
    },
  };
}

export async function navigateToReturnDashboardPage(
  documentRef: Document,
  scopeId = FILED_RETURNS_SCOPE_ID,
): Promise<PortalNavigationResult> {
  const blockedState = detectBlockedPortalState(documentRef);
  if (blockedState) return { ...blockedState, scopeId };

  const safeSignals: string[] = [];
  const dismissedDialogs = await dismissSafePostLoginDialogs(documentRef);
  safeSignals.push(...dismissedDialogs);

  const firstPass = clickBestReturnDashboardCandidate(
    documentRef,
    "return-dashboard-initial-scan",
    safeSignals,
    scopeId,
  );
  if (firstPass) return firstPass;

  revealMenuCandidate(documentRef, isServicesMenuCandidate);
  await delay(MENU_REVEAL_DELAY_MS);
  safeSignals.push(...(await dismissSafePostLoginDialogs(documentRef)));

  const afterServices = clickBestReturnDashboardCandidate(
    documentRef,
    "return-dashboard-after-services-menu",
    safeSignals,
    scopeId,
  );
  if (afterServices) return afterServices;

  revealMenuCandidate(documentRef, isReturnsMenuCandidate);
  await delay(MENU_REVEAL_DELAY_MS);
  safeSignals.push(...(await dismissSafePostLoginDialogs(documentRef)));

  const afterReturns = clickBestReturnDashboardCandidate(
    documentRef,
    "return-dashboard-after-returns-menu",
    safeSignals,
    scopeId,
  );
  if (afterReturns) return afterReturns;

  const diagnostics = collectSafeNavigationDiagnostics(
    getClickableElements(documentRef).map(toNavigationCandidateInput),
  );

  return {
    connectorId: "gst",
    scopeId,
    state: "candidate-not-found",
    safeSignals: [
      ...safeSignals,
      "no-return-dashboard-candidate",
      ...diagnostics.map((label) => `visible-nav:${label.toLowerCase().replace(/\s+/g, "-")}`),
    ],
    safeMessage:
      "Pack could not find the portal's Return Dashboard entry yet. Use GST Portal navigation only: Services > Returns > Returns Dashboard, then run Pack again.",
    userAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: "Open Services > Returns > Returns Dashboard in the GST portal.",
      canResume: true,
    },
  };
}

export async function dismissKnownFiledReturnsSummaryModal(
  documentRef: Document,
): Promise<string[]> {
  const modalRoot = getVisibleDialogRoots(documentRef).find((root) =>
    SUMMARY_MODAL_PATTERN.test(root.innerText || root.textContent || ""),
  );
  if (!modalRoot) return [];

  const clickableElements = getClickableElements(modalRoot);
  let bestElement: HTMLElement | null = null;
  let bestScore: NavigationCandidateScore = { score: 0, safeSignals: [] };

  for (const element of clickableElements) {
    const score = scoreFiledReturnsSummaryModalDismissalCandidate(
      toNavigationCandidateInput(element),
    );
    if (score.score > bestScore.score) {
      bestScore = score;
      bestElement = element;
    }
  }

  if (bestElement && bestScore.score >= 60) {
    activateElement(bestElement);
    await waitForDialogRootToSettle(modalRoot);
    return ["detail-summary-modal-dismissed", ...bestScore.safeSignals];
  }

  dispatchEscapeKey(modalRoot);
  await waitForDialogRootToSettle(modalRoot);
  return ["detail-summary-modal-escape-attempted"];
}

function clickBestFiledReturnsCandidate(
  documentRef: Document,
  scanStage: string,
  prefixSignals: readonly string[],
): PortalNavigationResult | null {
  const elements = getClickableElements(documentRef);
  const candidates = elements.map(toNavigationCandidateInput);
  const candidateIndex = findFiledReturnsNavigationCandidateIndex(candidates);
  if (candidateIndex === -1) return null;

  const candidate = candidates[candidateIndex];
  const element = elements[candidateIndex];
  if (!candidate || !element) return null;

  const score = scoreFiledReturnsNavigationCandidate(candidate);
  activateElement(element);

  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "clicked",
    safeSignals: [
      ...prefixSignals,
      "filed-returns-candidate-clicked",
      scanStage,
      ...score.safeSignals,
    ],
    safeMessage: "Pack clicked the portal's View Filed Returns navigation candidate.",
  };
}

export function clickBestReturnDashboardCandidate(
  documentRef: Document,
  scanStage: string,
  prefixSignals: readonly string[],
  scopeId = FILED_RETURNS_SCOPE_ID,
): PortalNavigationResult | null {
  const elements = getClickableElements(documentRef);
  const candidateIndex = findReturnDashboardCandidateIndex(
    elements.map(toNavigationCandidateInput),
  );
  if (candidateIndex === -1) return null;

  const element = elements[candidateIndex];
  if (!element) return null;

  const score = scoreReturnDashboardNavigationCandidate(toNavigationCandidateInput(element));
  activateElement(element);

  return {
    connectorId: "gst",
    scopeId,
    state: "clicked",
    safeSignals: [
      ...prefixSignals,
      "return-dashboard-candidate-clicked",
      scanStage,
      ...score.safeSignals,
    ],
    safeMessage:
      "Pack clicked the GST Return Dashboard entry. After the portal loads, click Start download again if Pack is not already on View Filed Returns.",
  };
}

function clickBestHiddenFiledReturnsMenuCandidate(
  documentRef: Document,
  scanStage: string,
  prefixSignals: readonly string[],
): PortalNavigationResult | null {
  const candidates = getClickableElements(documentRef, { includeHidden: true })
    .filter((element) => !isVisible(element))
    .map((element) => ({
      element,
      candidate: toNavigationCandidateInput(element),
    }))
    .map(({ element, candidate }) => ({
      element,
      candidate,
      score: scoreFiledReturnsNavigationCandidate(candidate),
    }))
    .filter(({ score }) => {
      const isExplicitFiledReturnsTarget =
        score.safeSignals.includes("text-view-filed-returns") ||
        score.safeSignals.includes("href-efiledreturns");
      return (
        score.score >= 90 &&
        isExplicitFiledReturnsTarget &&
        !score.safeSignals.includes("excluded-account-navigation")
      );
    })
    .sort((left, right) => right.score.score - left.score.score);

  const best = candidates[0];
  if (!best) return null;

  activateElement(best.element);

  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "clicked",
    safeSignals: [
      ...prefixSignals,
      "hidden-filed-returns-candidate-clicked",
      scanStage,
      ...best.score.safeSignals,
    ],
    safeMessage: "Pack clicked the portal's hidden View Filed Returns menu candidate.",
  };
}

function isReturnDashboardRoute(documentRef: Document): boolean {
  const location = documentRef.defaultView?.location;
  return Boolean(location && /\/returns\/auth\/dashboard\/?$/i.test(location.pathname));
}

export async function dismissSafePostLoginDialogs(documentRef: Document): Promise<string[]> {
  const signals: string[] = [];
  const dismissedElements = new Set<HTMLElement>();

  for (let iteration = 0; iteration < MAX_DIALOG_DISMISSALS; iteration += 1) {
    const elements = getVisibleDialogElements(documentRef).filter(
      (element) => !dismissedElements.has(element),
    );
    const candidates = elements.map(toNavigationCandidateInput);
    const candidateIndex = findDialogDismissalCandidateIndex(candidates);
    if (candidateIndex === -1) break;

    const candidate = candidates[candidateIndex];
    const element = elements[candidateIndex];
    if (!candidate || !element) break;

    const score = scoreDialogDismissalCandidate(candidate);
    dismissedElements.add(element);
    activateElement(element);
    signals.push("safe-dialog-dismissed", ...score.safeSignals);
    await waitForDialogRootToSettle(element.closest(MODAL_SELECTOR) ?? element);
  }

  return signals;
}

export function hasVisibleSafePostLoginDialog(documentRef: Document): boolean {
  return getVisiblePostLoginDialogRoots(documentRef).length > 0;
}

function revealMenuCandidate(
  documentRef: Document,
  predicate: (candidate: NavigationCandidateInput) => boolean,
) {
  const element = getClickableElements(documentRef).find((candidateElement) =>
    predicate(toNavigationCandidateInput(candidateElement)),
  );
  if (!element) return;

  dispatchPointerSequence(element);
  const FocusEventConstructor = element.ownerDocument.defaultView?.FocusEvent;
  if (FocusEventConstructor) {
    element.dispatchEvent(new FocusEventConstructor("focus", { bubbles: true }));
  }
  element.click();
}

function isServicesMenuCandidate(candidate: NavigationCandidateInput): boolean {
  return /^services\s*$/i.test(normaliseCandidateText([candidate.text, candidate.ariaLabel]));
}

function isReturnsMenuCandidate(candidate: NavigationCandidateInput): boolean {
  return /^returns\s*$/i.test(normaliseCandidateText([candidate.text, candidate.ariaLabel]));
}

function getClickableElements(
  root: ParentNode,
  options: { includeHidden?: boolean } = {},
): HTMLElement[] {
  const elements = Array.from(root.querySelectorAll(CLICKABLE_SELECTOR)).filter(
    (element): element is HTMLElement => isHtmlElement(root, element),
  );
  return options.includeHidden ? elements : elements.filter(isVisible);
}

function getVisibleDialogRoots(documentRef: Document): HTMLElement[] {
  const roots = Array.from(documentRef.querySelectorAll(MODAL_SELECTOR)).filter(
    (element): element is HTMLElement => isHtmlElement(documentRef, element) && isVisible(element),
  );
  roots.push(...getKnownPostLoginDialogRoots(documentRef));
  roots.push(...getKnownFiledReturnsSummaryDialogRoots(documentRef));
  return dedupeElements(roots);
}

function getVisiblePostLoginDialogRoots(documentRef: Document): HTMLElement[] {
  return getVisibleDialogRoots(documentRef).filter((root) => {
    const text = root.innerText || root.textContent || "";
    return SAFE_POST_LOGIN_DIALOG_PATTERNS.some((pattern) => pattern.test(text));
  });
}

function getKnownPostLoginDialogRoots(documentRef: Document): HTMLElement[] {
  const roots: HTMLElement[] = [];
  const dismissiveElements = getClickableElements(documentRef).filter((element) => {
    const score = scoreDialogDismissalCandidate(toNavigationCandidateInput(element));
    return score.score >= 70 && isVisible(element);
  });

  for (const element of dismissiveElements) {
    let current: HTMLElement | null = element;
    for (let depth = 0; current && depth < 8; depth += 1) {
      const text = current.innerText || current.textContent || "";
      if (SAFE_POST_LOGIN_DIALOG_PATTERNS.some((pattern) => pattern.test(text))) {
        roots.push(current);
        break;
      }
      current = current.parentElement;
    }
  }

  return roots.filter((element) => isVisible(element));
}

function getKnownFiledReturnsSummaryDialogRoots(documentRef: Document): HTMLElement[] {
  const roots: HTMLElement[] = [];
  const dismissiveElements = getClickableElements(documentRef).filter((element) => {
    const score = scoreFiledReturnsSummaryModalDismissalCandidate(
      toNavigationCandidateInput(element),
    );
    return score.score >= 60 && isVisible(element);
  });

  for (const element of dismissiveElements) {
    let current: HTMLElement | null = element;
    for (let depth = 0; current && depth < 8; depth += 1) {
      const text = current.innerText || current.textContent || "";
      if (SUMMARY_MODAL_PATTERN.test(text)) {
        roots.push(current);
        break;
      }
      current = current.parentElement;
    }
  }

  return roots.filter((element) => isVisible(element));
}

function getVisibleDialogElements(documentRef: Document): HTMLElement[] {
  return getVisiblePostLoginDialogRoots(documentRef).flatMap((root) =>
    Array.from(root.querySelectorAll(CLICKABLE_SELECTOR)).filter(
      (element): element is HTMLElement => isHtmlElement(root, element) && isVisible(element),
    ),
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
  const className = element.className;
  const title = element.getAttribute("title");

  if (href) input.href = href;
  if (ariaLabel) input.ariaLabel = ariaLabel;
  if (typeof className === "string" && className.trim()) input.className = className;
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

function dispatchEscapeKey(element: HTMLElement) {
  const KeyboardEventConstructor = element.ownerDocument.defaultView?.KeyboardEvent;
  if (!KeyboardEventConstructor) return;

  for (const target of [element, element.ownerDocument]) {
    target.dispatchEvent(
      new KeyboardEventConstructor("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
        code: "Escape",
      }),
    );
  }
}

function detectBlockedPortalState(documentRef: Document): PortalNavigationResult | null {
  const issue = detectFiledReturnsPortalAvailabilityIssue(documentRef);
  if (!issue) return null;
  return {
    connectorId: issue.connectorId,
    scopeId: issue.scopeId,
    state: issue.state === "login-required" ? "login-required" : "blocked",
    safeSignals: issue.safeSignals,
    safeMessage: issue.safeMessage,
    ...(issue.userAction ? { userAction: issue.userAction } : {}),
  };
}

function isVisible(element: HTMLElement): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || element.offsetParent !== null;
}

async function waitForDialogRootToSettle(element: Element): Promise<void> {
  const maxAttempts = Math.ceil(DIALOG_SETTLE_DELAY_MS / DIALOG_SETTLE_POLL_MS);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!isElementStillConnectedAndVisible(element)) return;
    await delay(DIALOG_SETTLE_POLL_MS);
  }
}

function isElementStillConnectedAndVisible(element: Element): boolean {
  if (!element.isConnected) return false;
  return isHtmlElement(element.ownerDocument, element) && isVisible(element);
}

function isHtmlElement(root: ParentNode, element: Element): element is HTMLElement {
  const documentRef = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  if (!documentRef) return false;
  const HTMLElementConstructor = documentRef.defaultView?.HTMLElement;
  return HTMLElementConstructor ? element instanceof HTMLElementConstructor : false;
}

function dedupeElements<T extends HTMLElement>(elements: readonly T[]): T[] {
  return elements.filter((element, index) => elements.indexOf(element) === index);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
