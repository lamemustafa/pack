import {
  detectVisibleReturnLabel,
  scopeIdForVisibleReturnLabel,
} from "./filed-returns-observer-scope";
import { detectSafeSignals } from "./filed-returns-observer-signals";
import type {
  FiledReturnsObservation,
  FiledReturnsObservationHints,
} from "./filed-returns-observer-types";
export type {
  FiledReturnsObservation,
  FiledReturnsObservationHints,
  FiledReturnsObservationState,
} from "./filed-returns-observer-types";

export function observeFiledReturnsPageText(
  text: string,
  hints: FiledReturnsObservationHints = {},
): FiledReturnsObservation {
  const normalised = text.toLowerCase().replace(/\s+/g, " ").trim();
  const safeSignals = detectSafeSignals(normalised, hints);

  if (safeSignals.includes("login")) {
    return {
      connectorId: "gst",
      pageKind: "gst-filed-returns",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "login-required",
      safeSignals: ["login"],
      safeMessage: "Sign in to the GST Portal, then reopen Pack.",
      userAction: {
        type: "LOGIN",
        message: "Sign in to the GST Portal in this browser tab, then reopen Pack.",
        canResume: true,
      },
    };
  }

  if (!safeSignals.includes("filed-returns-heading")) {
    return {
      connectorId: "gst",
      pageKind: "gst-filed-returns",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "wrong-page",
      safeSignals,
      safeMessage: "Navigate to Services > Returns > View Filed Returns.",
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: "Navigate to Services > Returns > View Filed Returns.",
        canResume: true,
      },
    };
  }

  if (safeSignals.includes("detail-summary-modal")) {
    return {
      connectorId: "gst",
      pageKind: "gst-filed-returns",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "detail-summary-modal-open",
      safeSignals,
      safeMessage:
        "The filed GSTR-3B detail page is open, but an informational summary modal is blocking the final download controls. Close the modal and run the check again.",
    };
  }

  if (safeSignals.includes("download-filed-gstr-3b")) {
    return {
      connectorId: "gst",
      pageKind: "gst-filed-returns",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "ready",
      safeSignals,
      safeMessage: "Filed GSTR-3B PDF controls appear ready for the private spike.",
    };
  }

  if (
    safeSignals.includes("download-gstr2b-summary-pdf") ||
    safeSignals.includes("download-gstr2b-details-excel")
  ) {
    return {
      connectorId: "gst",
      pageKind: "gst-filed-returns",
      scopeId: "gst-gstr2b-private-v0",
      state: "ready",
      safeSignals,
      safeMessage: "GSTR-2B download controls appear ready.",
    };
  }

  if (
    safeSignals.includes("download-filed-gstr-1") ||
    safeSignals.includes("download-pdf-gstr-1") ||
    safeSignals.includes("download-excel-gstr-1")
  ) {
    return {
      connectorId: "gst",
      pageKind: "gst-filed-returns",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "ready",
      safeSignals,
      safeMessage: "Filed GSTR-1 download controls appear ready.",
    };
  }

  if (safeSignals.includes("view-download-column") && safeSignals.includes("view-action")) {
    return {
      connectorId: "gst",
      pageKind: "gst-filed-returns",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "filed-return-results-visible",
      safeSignals,
      safeMessage:
        "Filed return results are visible. Open a row with View to expose the portal's final PDF/download controls.",
    };
  }

  if (safeSignals.includes("filter-form")) {
    return {
      connectorId: "gst",
      pageKind: "gst-filed-returns",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "filters-required",
      safeSignals,
      safeMessage:
        "The filed returns filter form is visible. Select Financial Year, Return Filing Period, Return Type, then click Search.",
    };
  }

  if (
    safeSignals.includes("filed-returns-route") &&
    !safeSignals.includes("view-download-column") &&
    !safeSignals.includes("download-filed-gstr-3b") &&
    !safeSignals.includes("download-filed-gstr-1") &&
    !safeSignals.includes("download-excel-gstr-1") &&
    !safeSignals.includes("search-action")
  ) {
    return {
      connectorId: "gst",
      pageKind: "gst-filed-returns",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "page-settling",
      safeSignals,
      safeMessage: "The filed returns page route is open and Pack is waiting for the form to load.",
    };
  }

  if (
    !safeSignals.includes("gstr-3b") &&
    !safeSignals.includes("gstr-1") &&
    !safeSignals.includes("gstr-2b")
  ) {
    return {
      connectorId: "gst",
      pageKind: "gst-filed-returns",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "gstr-3b-not-visible",
      safeSignals,
      safeMessage:
        "The filed returns page is visible, but the requested return type is not visible yet.",
    };
  }

  const visibleReturnLabel = detectVisibleReturnLabel(safeSignals);

  return {
    connectorId: "gst",
    pageKind: "gst-filed-returns",
    scopeId: scopeIdForVisibleReturnLabel(visibleReturnLabel),
    state: "download-not-visible",
    safeSignals,
    safeMessage: `${visibleReturnLabel} is visible, but a filed-return download control is not visible.`,
  };
}
