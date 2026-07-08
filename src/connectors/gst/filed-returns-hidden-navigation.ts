import type { PortalNavigationResult } from "../../core/contracts";
import {
  activateElement,
  getClickableElements,
  isVisible,
  toNavigationCandidateInput,
} from "./filed-returns-navigation-dom";
import { scoreFiledReturnsNavigationCandidate } from "./filed-returns-navigation-candidates";

export function clickBestHiddenFiledReturnsMenuCandidate(
  documentRef: Document,
  scopeId: string,
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
    .filter(({ score }) => isHighConfidenceHiddenFiledReturnsTarget(score.safeSignals, score.score))
    .sort((left, right) => right.score.score - left.score.score);

  const best = candidates[0];
  if (!best) return null;

  activateElement(best.element);

  return {
    connectorId: "gst",
    scopeId,
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

function isHighConfidenceHiddenFiledReturnsTarget(
  safeSignals: readonly string[],
  score: number,
): boolean {
  const isExplicitFiledReturnsTarget =
    safeSignals.includes("text-view-filed-returns") || safeSignals.includes("href-efiledreturns");
  return (
    score >= 90 &&
    isExplicitFiledReturnsTarget &&
    !safeSignals.includes("excluded-account-navigation")
  );
}
