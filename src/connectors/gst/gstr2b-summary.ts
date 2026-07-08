import type {
  FiledReturnsDownloadScope,
  PortalDownloadTriggerResult,
  PortalFlowStepResult,
} from "../../core/contracts";
import {
  activateElement,
  getClickableElements,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";
import { acceptedFiledReturnsMonthTexts } from "./filed-returns-months";
import { clickBestReturnDashboardCandidate } from "./filed-returns-navigator";
import { filedReturnScopeId } from "./filed-returns-return-descriptors";

const GSTR2B_SUMMARY_ROUTE = /\/gstr2b\/auth\/gstr2b\/summary\/?$/i;
const GSTR2B_AUTH_ROUTE = /\/gstr2b\/auth(?:\/|$)/i;

export function isGstr2bSummaryPage(documentRef: Document, normalisedText: string): boolean {
  const pathname = documentRef.defaultView?.location.pathname ?? "";
  return (
    GSTR2B_SUMMARY_ROUTE.test(pathname) &&
    normalisedText.includes("gstr-2b") &&
    normalisedText.includes("download gstr-2b summary") &&
    normalisedText.includes("download gstr-2b details")
  );
}

export function isGstr2bAuthRoute(documentRef: Document): boolean {
  const pathname = documentRef.defaultView?.location.pathname ?? "";
  return GSTR2B_AUTH_ROUTE.test(pathname);
}

export function hasGstr2bLoginEvidence(
  documentRef: Document,
  normalisedText: string,
): boolean {
  const pathname = documentRef.defaultView?.location.pathname ?? "";
  if (/(?:\/services\/login|\/login)$/i.test(pathname)) return true;
  if (
    /session (?:is |has )?expired|please login again|invalid session|logged out/.test(
      normalisedText,
    )
  ) {
    return true;
  }
  return (
    /\blogin\b|\bsign in\b/.test(normalisedText) &&
    /\b(username|user id|captcha)\b/.test(normalisedText)
  );
}

export function verifyVisibleGstr2bSummaryScope(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): PortalDownloadTriggerResult | null {
  const normalised = normaliseText(readDocumentText(documentRef));
  if (!isGstr2bSummaryPage(documentRef, normalised)) return null;
  return verifyVisibleGstr2bPeriod(normalised, scope);
}

export function verifyVisibleGstr2bPeriod(
  normalisedText: string,
  scope: FiledReturnsDownloadScope,
): PortalDownloadTriggerResult | null {
  const visiblePeriod = extractGstr2bLabelValue(normalisedText, "return period");
  const visibleFinancialYear = extractGstr2bLabelValue(normalisedText, "financial year");
  const monthMatches = visiblePeriod
    ? matchesAcceptedText(visiblePeriod, acceptedFiledReturnsMonthTexts(scope.period))
    : acceptedFiledReturnsMonthTexts(scope.period).some((period) =>
        matchesAcceptedText(normalisedText, [period]),
      );
  const yearMatches = visibleFinancialYear
    ? matchesAcceptedText(visibleFinancialYear, [scope.financialYear])
    : expectedCalendarYears(scope).some((year) => normalisedText.includes(year));
  if (monthMatches && yearMatches) return null;

  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId("GSTR-2B"),
    state: "blocked",
    safeSignals: ["gstr2b-visible-period-mismatch"],
    safeMessage:
      "Pack found a GSTR-2B summary page, but could not verify that its visible period matches the requested scope.",
    userAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: "Open the GSTR-2B summary page for the requested month and financial year.",
      canResume: true,
    },
  };
}

export function returnFromMismatchedGstr2bSummary(
  documentRef: Document,
  scopeId: string,
  safeSignals: readonly string[],
): PortalFlowStepResult | null {
  const dashboardBackControl = findGstr2bSummaryDashboardBackControl(documentRef);
  if (dashboardBackControl) {
    activateElement(dashboardBackControl);
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: Array.from(
        new Set([
          ...safeSignals,
          "gstr2b-summary-period-mismatch",
          "gstr2b-summary-dashboard-back-clicked",
        ]),
      ),
      safeMessage:
        "Pack found a GSTR-2B summary for a different period and clicked Back to Dashboard so it can select the requested period.",
    };
  }

  const history = documentRef.defaultView?.history;
  if (history && typeof history.back === "function") {
    history.back();
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: Array.from(
        new Set([...safeSignals, "gstr2b-summary-period-mismatch", "gstr2b-summary-back-clicked"]),
      ),
      safeMessage:
        "Pack found a GSTR-2B summary for a different period and returned to the GST Return Dashboard so it can select the requested period.",
    };
  }

  const dashboardNavigation = clickBestReturnDashboardCandidate(
    documentRef,
    "gstr2b-summary-period-mismatch",
    safeSignals,
    scopeId,
  );
  if (!dashboardNavigation) return null;
  return {
    ...dashboardNavigation,
    safeMessage:
      "Pack found a GSTR-2B summary for a different period and opened the GST Return Dashboard so it can select the requested period.",
  };
}

export function readDocumentText(documentRef: Document): string {
  return documentRef.body?.innerText || documentRef.body?.textContent || "";
}

function extractGstr2bLabelValue(
  normalisedText: string,
  label: "financial year" | "return period",
): string | null {
  const pattern =
    label === "financial year"
      ? /\bfinancial\s+year\s*[-:]\s*([0-9]{4}\s*-\s*[0-9]{2})\b/
      : /\breturn\s+period\s*[-:]\s*([a-z]+)\b/;
  const match = normalisedText.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function expectedCalendarYears(scope: FiledReturnsDownloadScope): string[] {
  const match = /^(20\d{2})-\d{2}$/.exec(scope.financialYear);
  if (!match?.[1]) return [];
  const startYear = Number(match[1]);
  return scope.period === "January" || scope.period === "February" || scope.period === "March"
    ? [String(startYear + 1)]
    : [String(startYear)];
}

function findGstr2bSummaryDashboardBackControl(documentRef: Document): HTMLElement | null {
  return (
    getClickableElements(documentRef).find((element) => {
      const text = normaliseText(readElementText(element));
      return /^back\s+to\s+dashboard$/.test(text) || /^back$/.test(text);
    }) ?? null
  );
}

function readElementText(element: HTMLElement): string {
  const HTMLInputElementConstructor = element.ownerDocument.defaultView?.HTMLInputElement;
  const inputValue =
    HTMLInputElementConstructor && element instanceof HTMLInputElementConstructor
      ? element.value
      : "";
  return [
    element.innerText || "",
    element.textContent || "",
    inputValue,
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
  ].join(" ");
}
