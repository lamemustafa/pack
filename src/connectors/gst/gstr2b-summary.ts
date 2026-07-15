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

export function hasGstr2bLoginEvidence(documentRef: Document, normalisedText: string): boolean {
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
  return verifyVisibleGstr2bPeriod(documentRef, normalised, scope);
}

export function verifyVisibleGstr2bPeriod(
  documentRef: Document,
  normalisedText: string,
  scope: FiledReturnsDownloadScope,
): PortalDownloadTriggerResult | null {
  const serverScope = extractGstr2bServerScope(documentRef);
  if (serverScope) {
    if (gstr2bScopeMatches(serverScope, scope)) return null;
    return gstr2bPeriodMismatch(["gstr2b-server-period-mismatch"]);
  }

  const visiblePeriod = extractGstr2bLabelValue(normalisedText, "return period");
  const visibleFinancialYear = extractGstr2bLabelValue(normalisedText, "financial year");
  const statementScope = extractGstr2bStatementScope(documentRef);
  const verifiedPeriod = visiblePeriod ?? statementScope?.period ?? null;
  const verifiedFinancialYear = visibleFinancialYear ?? statementScope?.financialYear ?? null;
  if (!verifiedPeriod || !verifiedFinancialYear) {
    // Whole-page month/year matches are not target evidence: generated-on text and table
    // content can mention another period. Only labels or the portal statement heading qualify.
    return gstr2bPeriodMismatch(["gstr2b-labelled-period-evidence-missing"]);
  }
  const monthMatches = matchesAcceptedText(
    verifiedPeriod,
    acceptedFiledReturnsMonthTexts(scope.period),
  );
  const yearMatches = matchesAcceptedText(verifiedFinancialYear, [scope.financialYear]);
  if (monthMatches && yearMatches) return null;

  return gstr2bPeriodMismatch([]);

  function gstr2bPeriodMismatch(extraSignals: string[]): PortalDownloadTriggerResult {
    return {
      connectorId: "gst",
      scopeId: filedReturnScopeId("GSTR-2B"),
      state: "blocked",
      safeSignals: ["gstr2b-visible-period-mismatch", ...extraSignals],
      safeMessage:
        "Pack found a GSTR-2B summary page, but could not verify that its visible period matches the requested scope.",
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: "Open the GSTR-2B summary page for the requested month and financial year.",
        canResume: true,
      },
    };
  }
}

function gstr2bScopeMatches(
  pageScope: { financialYear: string; period: string },
  scope: FiledReturnsDownloadScope,
): boolean {
  return (
    matchesAcceptedText(pageScope.financialYear, [scope.financialYear]) &&
    matchesAcceptedText(pageScope.period, acceptedFiledReturnsMonthTexts(scope.period))
  );
}

function extractGstr2bServerScope(
  documentRef: Document,
): { financialYear: string; period: string } | null {
  const scriptText = Array.from(documentRef.scripts)
    .map((script) => script.textContent ?? "")
    .join("\n");
  if (!/"FORM_TYPE"\s*:\s*"GSTR2B"/i.test(scriptText)) return null;

  const financialYear = matchServerValue(scriptText, "FIN_YEAR");
  const returnPeriod = matchServerValue(scriptText, "RETURN_PERIOD");
  if (!financialYear || !returnPeriod) return null;

  const period = monthFromReturnPeriod(returnPeriod);
  return period ? { financialYear, period } : null;
}

function matchServerValue(scriptText: string, key: "FIN_YEAR" | "RETURN_PERIOD"): string | null {
  const match = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, "i").exec(scriptText);
  return match?.[1]?.trim() ?? null;
}

function monthFromReturnPeriod(returnPeriod: string): string | null {
  const match = /^(0[1-9]|1[0-2])20\d{2}$/.exec(returnPeriod.trim());
  if (!match?.[1]) return null;
  const monthIndex = Number(match[1]) - 1;
  return (
    [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ][monthIndex] ?? null
  );
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

function extractGstr2bStatementScope(
  documentRef: Document,
): { financialYear: string; period: string } | null {
  const statementTextSelector = "h1, h2, h3, h4, h5, h6, p, div, span, [role='heading']";
  const monthPattern =
    "january|february|march|april|may|june|july|august|september|october|november|december";
  const statementPattern = new RegExp(
    `^(${monthPattern})\\s+(20\\d{2})\\s+auto\\s*-?\\s*drafted\\s+itc\\s+statement$`,
    "i",
  );
  const statementElements = Array.from(documentRef.querySelectorAll(statementTextSelector)).filter(
    isVisibleStatementElement,
  );
  for (const element of statementElements) {
    const text = normaliseText(element.textContent || "");
    const match = statementPattern.exec(text);
    if (!match?.[1] || !match[2]) continue;
    return statementScopeFromMonthAndYear(match[1], Number(match[2]));
  }

  const statementDescriptors = statementElements.filter((element) =>
    /^auto\s*-?\s*drafted\s+itc\s+statement\s+for\s+the\s+month$/i.test(
      normaliseText(element.textContent || ""),
    ),
  );
  if (statementDescriptors.length === 0) return null;

  const standalonePeriodPattern = new RegExp(`^(${monthPattern})\\s+(20\\d{2})$`, "i");
  const scopes = statementDescriptors
    .flatMap((descriptor) =>
      Array.from(descriptor.parentElement?.children ?? [])
        .filter((element) => element.matches(statementTextSelector))
        .filter(isVisibleStatementElement),
    )
    .map((element) => standalonePeriodPattern.exec(normaliseText(element.textContent || "")))
    .map((match) =>
      match?.[1] && match[2] ? statementScopeFromMonthAndYear(match[1], Number(match[2])) : null,
    )
    .filter((scope): scope is { financialYear: string; period: string } => Boolean(scope));
  const uniqueScopes = new Map(
    scopes.map((scope) => [`${scope.financialYear}:${normaliseText(scope.period)}`, scope]),
  );
  return uniqueScopes.size === 1 ? ([...uniqueScopes.values()][0] ?? null) : null;
}

function isVisibleStatementElement(element: Element): boolean {
  if (element.closest("script, style, template, noscript, [hidden], [aria-hidden='true']")) {
    return false;
  }
  const view = element.ownerDocument.defaultView;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const htmlElement = current as HTMLElement;
    const style = view?.getComputedStyle(htmlElement);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
  }
  return true;
}

function statementScopeFromMonthAndYear(
  period: string,
  calendarYear: number,
): { financialYear: string; period: string } {
  const financialYearStart = ["january", "february", "march"].includes(normaliseText(period))
    ? calendarYear - 1
    : calendarYear;
  return {
    financialYear: `${financialYearStart}-${String((financialYearStart + 1) % 100).padStart(2, "0")}`,
    period,
  };
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
