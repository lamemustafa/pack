import type { PortalNavigationResult } from "../../core/contracts";
import { dismissSafePostLoginDialogs } from "./filed-returns-dialogs";
import {
  collectSafeNavigationDiagnostics,
  findFiledReturnsNavigationCandidateIndex,
  findReturnDashboardCandidateIndex,
  scoreFiledReturnsNavigationCandidate,
  scoreReturnDashboardNavigationCandidate,
} from "./filed-returns-navigation-candidates";
import {
  activateElement,
  getClickableElements,
  isReturnsMenuCandidate,
  isServicesMenuCandidate,
  isVisible,
  revealMenuCandidate,
  toNavigationCandidateInput,
} from "./filed-returns-navigation-dom";
import { detectFiledReturnsPortalAvailabilityIssue } from "./filed-returns-portal-availability";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
const MENU_REVEAL_DELAY_MS = 350;

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
