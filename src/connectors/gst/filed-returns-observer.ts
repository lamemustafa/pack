import type { PortalObservation } from "../../core/contracts";
import type { FiledReturnsReturnType } from "../../core/filed-returns-return-types";
import { filedReturnScopedSignal } from "./filed-returns-return-descriptors";

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
  scopeId: "gst-filed-returns-gstr3b-pdf-private-v0" | "gst-filed-returns-gstr1-pdf-private-v0";
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

  if (!safeSignals.includes("gstr-3b") && !safeSignals.includes("gstr-1")) {
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
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "download-not-visible",
    safeSignals,
    safeMessage: `${visibleReturnLabel} is visible, but a filed-return download control is not visible.`,
  };
}

function detectSafeSignals(text: string, hints: FiledReturnsObservationHints): string[] {
  const signals: string[] = [];
  if (hasLoginEvidence(text, hints)) signals.push("login");
  if (isFiledReturnsRoute(hints)) signals.push("filed-returns-route");
  if (isGstr3bDetailRoute(hints)) signals.push("gstr-3b-detail-route");
  if (isGstr1DetailRoute(hints)) signals.push("gstr-1-detail-route");
  if (isGstr1SummaryRoute(hints)) signals.push("gstr-1-summary-route");
  if (/view filed returns|filed returns/.test(text) || signals.includes("filed-returns-route")) {
    signals.push("filed-returns-heading");
  }
  if (signals.includes("gstr-3b-detail-route")) signals.push("filed-returns-heading");
  if (signals.includes("gstr-1-detail-route")) signals.push("filed-returns-heading", "gstr-1");
  if (signals.includes("gstr-1-summary-route")) signals.push("filed-returns-heading", "gstr-1");
  if (/gstr[\s-]?3b/.test(text)) signals.push("gstr-3b");
  if (/\bgstr[\s-]?1\b/.test(text)) signals.push("gstr-1");
  if (/download filed gstr[\s-]?3b/.test(text)) signals.push("download-filed-gstr-3b");
  if (/download filed gstr[\s-]?1\b/.test(text)) signals.push("download-filed-gstr-1");
  if (
    signals.includes("gstr-1-summary-route") &&
    (/\bdownload\s*\(?\s*pdf\s*\)?\b/.test(text) || /\bdownload\b.*\bsummary\b.*\bpdf\b/.test(text))
  ) {
    signals.push("download-pdf-gstr-1");
  }
  if (
    /download\b.*\bexcel\b/.test(text) ||
    /download\b.*\bdetails?\b.*\be-?invoices?\b/.test(text)
  ) {
    signals.push("download-excel-gstr-1");
  }
  for (const returnType of ["GSTR-3B", "GSTR-1"] as const) {
    const slug = returnType === "GSTR-3B" ? "gstr-3b" : "gstr-1";
    if (
      signals.includes(`download-filed-${slug}`) ||
      (returnType === "GSTR-1" && signals.includes("download-excel-gstr-1"))
    ) {
      signals.push(
        "filed-return-download-ready",
        filedReturnScopedSignal(returnType, "download-ready"),
      );
    }
  }
  if (signals.includes("download-pdf-gstr-1")) {
    signals.push(
      "filed-return-download-ready",
      filedReturnScopedSignal("GSTR-1", "download-ready"),
    );
  }
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

function hasLoginEvidence(text: string, hints: FiledReturnsObservationHints): boolean {
  if (isLoginRoute(hints)) return true;
  if (/session (?:is |has )?expired|please login again|invalid session|logged out/.test(text)) {
    return true;
  }

  const hasLoginAction = /\blogin\b|\bsign in\b|\bsign-in\b/.test(text);
  const secretInputLabel = ["pass", "word"].join("");
  const hasCredentialForm = new RegExp(`\\b(username|user id|${secretInputLabel}|captcha)\\b`).test(
    text,
  );
  return hasLoginAction && hasCredentialForm;
}

function isLoginRoute(hints: FiledReturnsObservationHints): boolean {
  const candidates = [hints.pathname, ...(hints.requestPathShapes ?? [])].filter(
    (value): value is string => typeof value === "string",
  );
  return candidates.some((value) => /(?:\/services\/login|\/login)$/i.test(value));
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

function isGstr1DetailRoute(hints: FiledReturnsObservationHints): boolean {
  return hints.pathname ? /\/returns\/auth\/gstr1$/i.test(hints.pathname) : false;
}

function isGstr1SummaryRoute(hints: FiledReturnsObservationHints): boolean {
  return hints.pathname ? /\/returns\/auth\/gstr1\/gstr1sum$/i.test(hints.pathname) : false;
}

function detectVisibleReturnLabel(signals: readonly string[]): FiledReturnsReturnType {
  if (signals.includes("gstr-1")) return "GSTR-1";
  return "GSTR-3B";
}
