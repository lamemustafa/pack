import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import {
  activateElement,
  getClickableElements,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";
import {
  extractFiledReturnsDetailIdentity,
  extractTaxPeriodFromRow,
} from "./filed-returns-detail-identity";
import {
  dismissKnownFiledReturnsSummaryModal,
  navigateToFiledReturnsPage,
} from "./filed-returns-navigator";
import { selectFiledReturnsFiltersAndSearch } from "./filed-returns-filter-form";
import { observeFiledReturnsPageText } from "./filed-returns-observer";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
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
    const detailIdentity = extractFiledReturnsDetailIdentity(documentRef);
    if (shouldReturnFromMismatchedDetail(detailIdentity, scope)) {
      return clickFiledReturnDetailBack(documentRef);
    }
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "ready",
      safeSignals: ["filed-gstr3b-download-ready", ...detailIdentity.safeSignals],
      safeMessage:
        "Pack found the filed GSTR-3B detail page and is ready to start the browser download.",
    };
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
    .map((row) => ({ row, identity: extractResultRowIdentity(row) }))
    .filter(({ row, identity }) => {
      const rowText = row.textContent || "";
      const period = identity.period ?? extractTaxPeriodFromRow(row);
      const financialYear = identity.financialYear ?? rowText;
      const returnType = identity.returnType ?? rowText;
      return (
        matchesAcceptedText(returnType, [scope.returnType]) &&
        matchesAcceptedText(financialYear, [scope.financialYear]) &&
        periodMatchesScope(period, scope)
      );
    });

  const actionableRows = matchingRows
    .map(({ row, identity }) => ({
      row,
      period: identity.period ?? extractTaxPeriodFromRow(row),
      view: getClickableElements(row).find((element) =>
        /^view$/i.test(normaliseText(readElementText(element))),
      ),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        row: HTMLTableRowElement;
        period: string | null;
        view: HTMLElement;
      } => Boolean(candidate.view),
    );

  if (actionableRows.length > 1) {
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "blocked",
      safeSignals: ["filed-return-result-row-ambiguous"],
      safeMessage:
        "Pack found more than one filed GSTR-3B result row for the requested period. Open the correct row manually, then start Pack again.",
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: "Open the exact filed GSTR-3B row for the requested period.",
        canResume: true,
      },
    };
  }

  const actionableRow = actionableRows[0];
  if (actionableRow) {
    activateElement(actionableRow.view);
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "clicked",
      safeSignals: [
        "filed-return-result-view-clicked",
        "result-row-gstr3b",
        ...(actionableRow.period ? [`filed-return-result-period:${actionableRow.period}`] : []),
      ],
      safeMessage: "Pack opened the filed GSTR-3B result row.",
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
  return matchesAcceptedText(period, [scope.period]);
}

function shouldReturnFromMismatchedDetail(
  detailIdentity: ReturnType<typeof extractFiledReturnsDetailIdentity>,
  scope: FiledReturnsDownloadScope,
): boolean {
  if (!detailIdentity.period || !detailIdentity.financialYear) return false;
  return (
    !matchesAcceptedText(detailIdentity.period, [scope.period]) ||
    !matchesAcceptedText(detailIdentity.financialYear, [scope.financialYear])
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

function getBodyText(documentRef: Document): string {
  return documentRef.body?.innerText || documentRef.body?.textContent || "";
}

function extractResultRowIdentity(row: Element): {
  financialYear: string | null;
  period: string | null;
  returnType: string | null;
} {
  const cells = Array.from(row.querySelectorAll("td"));
  const headers = getResultTableHeaders(row);
  if (cells.length === 0 || headers.length === 0) {
    return { financialYear: null, period: null, returnType: null };
  }

  return {
    financialYear: readCellByHeader(cells, headers, /financial\s+year|^fy$/i),
    period: readCellByHeader(cells, headers, /tax\s+period|period|month/i),
    returnType: readCellByHeader(cells, headers, /return\s+type|return/i),
  };
}

function getResultTableHeaders(row: Element): string[] {
  const table = row.closest("table");
  if (!table) return [];
  const headerCells = Array.from(table.querySelectorAll("thead th"));
  const fallbackHeaderCells =
    headerCells.length > 0 ? headerCells : Array.from(table.querySelectorAll("th"));
  return fallbackHeaderCells.map((header) => normaliseText(readElementText(header)));
}

function readCellByHeader(cells: readonly Element[], headers: readonly string[], pattern: RegExp) {
  const index = headers.findIndex((header) => pattern.test(header));
  if (index < 0) return null;
  return readElementText(cells[index]).replace(/\s+/g, " ").trim() || null;
}

function readElementText(element: Element | null | undefined): string {
  if (!element) return "";
  const HTMLInputElementConstructor = element.ownerDocument.defaultView?.HTMLInputElement;
  const inputValue =
    HTMLInputElementConstructor && element instanceof HTMLInputElementConstructor
      ? element.value
      : "";
  return [
    "innerText" in element ? (element as HTMLElement).innerText : "",
    element.textContent ?? "",
    inputValue,
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

function withOptionalUserAction(
  result: Omit<PortalFlowStepResult, "userAction">,
  userAction: PortalFlowStepResult["userAction"],
): PortalFlowStepResult {
  return userAction ? { ...result, userAction } : result;
}
