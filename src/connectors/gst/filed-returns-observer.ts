import type { PortalObservation } from "../../core/contracts";

export type FiledReturnsObservationState =
  | "ready"
  | "filters-required"
  | "filed-return-results-visible"
  | "detail-summary-modal-open"
  | "login-required"
  | "wrong-page"
  | "page-settling"
  | "gstr-3b-not-visible"
  | "download-not-visible";

export type FiledReturnsObservation = PortalObservation & {
  scopeId: "gst-filed-returns-gstr3b-pdf-private-v0";
  state: FiledReturnsObservationState;
  pageKind: "gst-filed-returns";
};

export interface FiledReturnsObservationHints {
  pathname?: string;
  requestPathShapes?: readonly string[];
}

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

  if (safeSignals.includes("view-download-column") && safeSignals.includes("view-action")) {
    return {
      connectorId: "gst",
      pageKind: "gst-filed-returns",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "filed-return-results-visible",
      safeSignals,
      safeMessage:
        "Filed GSTR-3B results are visible. Open a row with View to expose the portal's final PDF/download controls.",
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
        "The filed returns filter form is visible. Select Financial Year, Return Filing Period and GSTR-3B, then click Search.",
    };
  }

  if (
    safeSignals.includes("filed-returns-route") &&
    !safeSignals.includes("view-download-column") &&
    !safeSignals.includes("download-filed-gstr-3b") &&
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

  if (!safeSignals.includes("gstr-3b")) {
    return {
      connectorId: "gst",
      pageKind: "gst-filed-returns",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "gstr-3b-not-visible",
      safeSignals,
      safeMessage: "The filed returns page is visible, but GSTR-3B is not visible yet.",
    };
  }

  return {
    connectorId: "gst",
    pageKind: "gst-filed-returns",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "download-not-visible",
    safeSignals,
    safeMessage: "GSTR-3B is visible, but a filed-return PDF download control is not visible.",
  };
}

function detectSafeSignals(text: string, hints: FiledReturnsObservationHints): string[] {
  const signals: string[] = [];
  if (/\blogin\b|\bsign in\b|\bsign-in\b/.test(text)) signals.push("login");
  if (isFiledReturnsRoute(hints)) signals.push("filed-returns-route");
  if (isGstr3bDetailRoute(hints)) signals.push("gstr-3b-detail-route");
  if (/view filed returns|filed returns/.test(text) || signals.includes("filed-returns-route")) {
    signals.push("filed-returns-heading");
  }
  if (signals.includes("gstr-3b-detail-route")) signals.push("filed-returns-heading");
  if (/gstr[\s-]?3b/.test(text)) signals.push("gstr-3b");
  if (/download filed gstr[\s-]?3b/.test(text)) signals.push("download-filed-gstr-3b");
  if (/system generated summary for gstr[\s-]?3b/.test(text)) {
    signals.push("detail-summary-modal");
  }
  if (
    /financial year/.test(text) &&
    /return filing period/.test(text) &&
    /return type/.test(text)
  ) {
    signals.push("filter-form");
  }
  if (/view\/download/.test(text)) signals.push("view-download-column");
  if (/\bview\b/.test(text)) signals.push("view-action");
  if (/\bsearch\b/.test(text)) signals.push("search-action");
  if (/\bfiled\b/.test(text)) signals.push("filed");
  if (/\bdownload\b/.test(text)) signals.push("download");
  if (/\bpdf\b/.test(text)) signals.push("pdf");
  return signals;
}

function isFiledReturnsRoute(hints: FiledReturnsObservationHints): boolean {
  const candidates = [hints.pathname, ...(hints.requestPathShapes ?? [])].filter(
    (value): value is string => typeof value === "string",
  );
  return candidates.some((value) =>
    /(?:\/pages\/returns\/efiledreturns\.html|\/returns\/auth\/efiledreturns)$/i.test(value),
  );
}

function isGstr3bDetailRoute(hints: FiledReturnsObservationHints): boolean {
  return hints.pathname ? /\/returns\/auth\/gstr3b$/i.test(hints.pathname) : false;
}
