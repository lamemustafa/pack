import { filedReturnScopedSignal } from "./filed-returns-return-descriptors";
import type { FiledReturnsObservationHints } from "./filed-returns-observer-types";

export function detectSafeSignals(text: string, hints: FiledReturnsObservationHints): string[] {
  const signals: string[] = [];
  if (hasLoginEvidence(text, hints)) signals.push("login");
  if (isFiledReturnsRoute(hints)) signals.push("filed-returns-route");
  if (isGstr3bDetailRoute(hints)) signals.push("gstr-3b-detail-route");
  if (isGstr1DetailRoute(hints)) signals.push("gstr-1-detail-route");
  if (isGstr1SummaryRoute(hints)) signals.push("gstr-1-summary-route");
  if (isGstr2bSummaryRoute(hints)) signals.push("gstr2b-summary-route", "gstr-2b");
  if (/view filed returns|filed returns/.test(text) || signals.includes("filed-returns-route")) {
    signals.push("filed-returns-heading");
  }
  if (signals.includes("gstr-3b-detail-route")) signals.push("filed-returns-heading");
  if (signals.includes("gstr-1-detail-route")) signals.push("filed-returns-heading", "gstr-1");
  if (signals.includes("gstr-1-summary-route")) signals.push("filed-returns-heading", "gstr-1");
  if (signals.includes("gstr2b-summary-route")) signals.push("filed-returns-heading", "gstr-2b");
  addReturnTextSignals(text, signals);
  addDownloadControlSignals(text, signals);
  addDownloadReadySignals(signals);
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

function addReturnTextSignals(text: string, signals: string[]): void {
  if (/gstr[\s-]?3b/.test(text)) signals.push("gstr-3b");
  if (/\bgstr[\s-]?1\b/.test(text)) signals.push("gstr-1");
  if (/\bgstr[\s-]?2b\b/.test(text)) signals.push("gstr-2b");
}

function addDownloadControlSignals(text: string, signals: string[]): void {
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
  if (/\bdownload\s+gstr[\s-]?2b\s+summary\s*\(?\s*pdf\s*\)?\b/.test(text)) {
    signals.push("download-gstr2b-summary-pdf");
  }
  if (/\bdownload\s+gstr[\s-]?2b\s+details\s*\(?\s*excel\s*\)?\b/.test(text)) {
    signals.push("download-gstr2b-details-excel");
  }
}

function addDownloadReadySignals(signals: string[]): void {
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
  if (
    signals.includes("download-gstr2b-summary-pdf") ||
    signals.includes("download-gstr2b-details-excel")
  ) {
    signals.push(
      "filed-return-download-ready",
      filedReturnScopedSignal("GSTR-2B", "download-ready"),
    );
  }
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
  return pathCandidates(hints).some((value) => /(?:\/services\/login|\/login)$/i.test(value));
}

function isFiledReturnsRoute(hints: FiledReturnsObservationHints): boolean {
  return pathCandidates(hints).some((value) =>
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

function isGstr2bSummaryRoute(hints: FiledReturnsObservationHints): boolean {
  return hints.pathname ? /\/gstr2b\/auth\/gstr2b\/summary\/?$/i.test(hints.pathname) : false;
}

function pathCandidates(hints: FiledReturnsObservationHints): string[] {
  return [hints.pathname, ...(hints.requestPathShapes ?? [])].filter(
    (value): value is string => typeof value === "string",
  );
}
