import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import {
  activateElement,
  getClickableElements,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";
import { triggerFiledGstr3bFiledPdfDownload } from "./filed-returns-download";
import {
  dismissKnownFiledReturnsSummaryModal,
  navigateToFiledReturnsPage,
} from "./filed-returns-navigator";
import { selectFiledReturnsFiltersAndSearch } from "./filed-returns-filter-form";
import { observeFiledReturnsPageText } from "./filed-returns-observer";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
const TAX_PERIODS = [
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
];

export async function runFiledReturnsDownloadStep(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): Promise<PortalFlowStepResult> {
  await dismissKnownFiledReturnsSummaryModal(documentRef);
  const observation = observeFiledReturnsPageText(getBodyText(documentRef), {
    ...(documentRef.defaultView?.location.pathname
      ? { pathname: documentRef.defaultView.location.pathname }
      : {}),
  });

  if (observation.state === "login-required") {
    return withOptionalUserAction(
      {
        connectorId: "gst",
        scopeId: FILED_RETURNS_SCOPE_ID,
        state: "login-required",
        safeSignals: observation.safeSignals,
        safeMessage: observation.safeMessage,
      },
      observation.userAction,
    );
  }

  if (observation.state === "ready") {
    if (shouldReturnFromDownloadedDetail(documentRef, scope)) {
      return clickFiledReturnDetailBack(documentRef);
    }
    const downloadTrigger = await triggerFiledGstr3bFiledPdfDownload(documentRef);
    const detailPeriod = extractDetailTaxPeriod(documentRef);
    if (
      detailPeriod &&
      !downloadTrigger.safeSignals.includes(`filed-return-detail-period:${detailPeriod}`)
    ) {
      return {
        ...downloadTrigger,
        safeSignals: [...downloadTrigger.safeSignals, `filed-return-detail-period:${detailPeriod}`],
      };
    }
    return downloadTrigger;
  }

  if (observation.state === "filters-required") {
    return selectFiledReturnsFiltersAndSearch(documentRef, scope, FILED_RETURNS_SCOPE_ID);
  }

  if (observation.state === "filed-return-results-visible") {
    return openFiledReturnResultRow(documentRef, scope);
  }

  if (observation.state === "page-settling") {
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "clicked",
      safeSignals: [...observation.safeSignals, "filed-returns-page-settling"],
      safeMessage: observation.safeMessage,
    };
  }

  if (observation.state === "wrong-page") {
    const navigation = await navigateToFiledReturnsPage(documentRef);
    return withOptionalUserAction(
      {
        connectorId: "gst",
        scopeId: FILED_RETURNS_SCOPE_ID,
        state: navigation.state,
        safeSignals: navigation.safeSignals,
        safeMessage: navigation.safeMessage,
      },
      navigation.userAction,
    );
  }

  return withOptionalUserAction(
    {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "user-action-required",
      safeSignals: observation.safeSignals,
      safeMessage: observation.safeMessage,
    },
    observation.userAction,
  );
}

function openFiledReturnResultRow(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): PortalFlowStepResult {
  const matchingRows = Array.from(documentRef.querySelectorAll("tr"))
    .map((row) => ({ row, period: extractTaxPeriod(row) }))
    .filter(({ row, period }) => {
      const rowText = row.textContent || "";
      return (
        matchesAcceptedText(rowText, [scope.returnType]) &&
        matchesAcceptedText(rowText, [scope.financialYear]) &&
        periodMatchesScope(period, scope)
      );
    });

  for (const { row, period } of matchingRows) {
    const view = getClickableElements(row).find((element) =>
      /^view$/i.test(normaliseText(element.innerText || element.textContent || "")),
    );
    if (!view) continue;

    activateElement(view);
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "clicked",
      safeSignals: [
        "filed-return-result-view-clicked",
        "result-row-gstr3b",
        ...(period ? [`filed-return-result-period:${period}`] : []),
      ],
      safeMessage: "Pack opened the filed GSTR-3B result row.",
    };
  }

  if (isEntireFinancialYearScope(scope) && clickNextResultsPage(documentRef)) {
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "clicked",
      safeSignals: ["filed-return-results-next-page-clicked"],
      safeMessage: "Pack moved to the next page of filed GSTR-3B results.",
    };
  }

  if (isEntireFinancialYearScope(scope) && (scope.completedPeriods?.length ?? 0) > 0) {
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "downloaded",
      safeSignals: [
        "filed-return-financial-year-complete",
        `filed-return-periods-downloaded:${scope.completedPeriods?.length ?? 0}`,
      ],
      safeMessage: "Pack processed the visible filed GSTR-3B results for the financial year.",
    };
  }

  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "candidate-not-found",
    safeSignals: ["filed-return-result-row-not-found"],
    safeMessage:
      "Pack could not find a filed GSTR-3B result row for the selected period. Check the portal results and start Pack again.",
  };
}

function periodMatchesScope(period: string | null, scope: FiledReturnsDownloadScope): boolean {
  if (!period) return false;
  if (!isEntireFinancialYearScope(scope)) return matchesAcceptedText(period, [scope.period]);
  return !new Set((scope.completedPeriods ?? []).map((value) => normaliseText(value))).has(
    normaliseText(period),
  );
}

function shouldReturnFromDownloadedDetail(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): boolean {
  if (!isEntireFinancialYearScope(scope)) return false;

  const period = extractDetailTaxPeriod(documentRef);
  if (!period) return false;

  return new Set((scope.completedPeriods ?? []).map((value) => normaliseText(value))).has(
    normaliseText(period),
  );
}

function clickFiledReturnDetailBack(documentRef: Document): PortalFlowStepResult {
  const backButton = getClickableElements(documentRef).find((element) => {
    const text = normaliseText(element.innerText || element.textContent || "");
    return text === "back";
  });

  if (!backButton) {
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "user-action-required",
      safeSignals: ["filed-return-detail-back-not-found"],
      safeMessage:
        "Pack downloaded this filed GSTR-3B, but could not find the portal Back button to continue the financial year.",
    };
  }

  activateElement(backButton);
  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "clicked",
    safeSignals: ["filed-return-detail-back-clicked"],
    safeMessage: "Pack returned from the filed GSTR-3B detail page to continue the year.",
  };
}

function extractDetailTaxPeriod(documentRef: Document): string | null {
  const text = getBodyText(documentRef);
  const normalised = normaliseText(text);
  const match = /return period\s*-\s*([a-z]+)/i.exec(normalised);
  if (!match?.[1]) return null;
  return TAX_PERIODS.find((period) => normaliseText(period) === match[1]) ?? null;
}

function extractTaxPeriod(row: Element): string | null {
  const cells = Array.from(row.querySelectorAll("td"));
  const periodCell = cells[2];
  const periodText = normaliseText(periodCell?.textContent || "");
  return TAX_PERIODS.find((period) => normaliseText(period) === periodText) ?? null;
}

function clickNextResultsPage(documentRef: Document): boolean {
  const paginationLinks = getClickableElements(documentRef).filter((element) => {
    const text = normaliseText(element.innerText || element.textContent || "");
    return text === "»" || text === "next";
  });

  const nextPage = paginationLinks.find((element) => !hasDisabledAncestor(element));
  if (!nextPage) return false;

  activateElement(nextPage);
  return true;
}

function hasDisabledAncestor(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 3; depth += 1) {
    if (
      current.classList.contains("disabled") ||
      current.getAttribute("aria-disabled") === "true"
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function isEntireFinancialYearScope(scope: FiledReturnsDownloadScope): boolean {
  return scope.period === "ALL";
}

function getBodyText(documentRef: Document): string {
  return documentRef.body?.innerText || documentRef.body?.textContent || "";
}

function withOptionalUserAction(
  result: Omit<PortalFlowStepResult, "userAction">,
  userAction: PortalFlowStepResult["userAction"],
): PortalFlowStepResult {
  return userAction ? { ...result, userAction } : result;
}
