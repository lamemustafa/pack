import type { PortalDownloadTriggerResult } from "../../core/contracts";
import type { FiledReturnsDownloadTarget } from "./filed-returns-contracts";
import { filedReturnScopeId } from "./filed-returns-return-descriptors";

// The portal declining to produce an artifact, in its own words.
//
// Two of these are captured live and neither is a failure. A filed GSTR-1 has no details workbook
// when the taxpayer reports no e-invoices. Separately, the portal may not draft the GSTR-2B
// statement for a period at all; the portal drafts that statement rather than the taxpayer
// submitting it. Both are answers. Retrying cannot change either within a run, and treating them
// as faults leaves the run offering a remedy that cannot work.
//
// Recognising a declined artifact records its absence with the portal's own reason. It never
// records a download: every result here is `blocked`, and completion still requires correlated
// download evidence.

function normalisedPageText(documentRef: Document): string {
  const text = documentRef.body?.innerText ?? documentRef.body?.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
}

function withSignal(safeSignals: string[], signal: string): string[] {
  return safeSignals.includes(signal) ? [...safeSignals] : [...safeSignals, signal];
}

export function detectPostClickBlockedState(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
  safeSignals: string[],
): PortalDownloadTriggerResult | null {
  const normalised = normalisedPageText(documentRef);
  if (target.returnType === "GSTR-1" && target.artifactType === "EXCEL") {
    return detectGstr1ExcelNoDetails(normalised, target, safeSignals);
  }
  if (target.returnType === "GSTR-2B") {
    return detectGstr2bNotGenerated(normalised, target, safeSignals);
  }
  return null;
}

function detectGstr1ExcelNoDetails(
  normalised: string,
  target: FiledReturnsDownloadTarget,
  safeSignals: string[],
): PortalDownloadTriggerResult | null {
  if (
    !/\bno\s+details\s+available\s+for\s+download\b/i.test(normalised) ||
    !/\be-?invoices?\b/i.test(normalised)
  ) {
    return null;
  }

  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(target.returnType),
    state: "blocked",
    safeSignals: withSignal(safeSignals, "filed-gstr1-excel-no-details-available"),
    safeMessage:
      "The GST Portal reported that no e-invoice details are available for this filed GSTR-1 period, so Pack did not record an Excel download. Retry after e-invoice details are available, or run PDF-only for this period.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message:
        "Close the GST Portal information dialog, then retry the GSTR-1 Excel download after e-invoice details are available.",
      canResume: true,
    },
  };
}

// Captured live on 2026-09-10. The summary page renders an error panel naming the system's own
// reasons: no records for the period, the previous period's GSTR-3B not filed by the generation
// date, or a QRMP taxpayer outside a quarter-ending month. Each means there is no GSTR-2B to
// download for this period, which is a state of the return rather than a fault in reaching it.
//
// Matched on the portal's statement, not on its list of causes, because the causes are advisory
// text that can be reworded independently of the outcome.
export function isGstr2bNotGeneratedText(pageText: string): boolean {
  return /\bgstr[\s-]?2b\s+could\s+not\s+be\s+generated\b/i.test(pageText);
}

/**
 * One wording, used by the step that observes the refusal and by the record it becomes.
 *
 * These were two strings saying the same thing differently -- the kind of duplicate nothing in
 * this repo can contradict, because no test compares a transient message with the durable one
 * that replaces it.
 */
export const GSTR2B_NOT_GENERATED_SAFE_MESSAGE =
  "The GST Portal reported that it did not generate the auto-drafted GSTR-2B statement for this period, so there is nothing for Pack to download. Pack recorded the period as unavailable rather than retrying.";

function detectGstr2bNotGenerated(
  normalised: string,
  target: FiledReturnsDownloadTarget,
  safeSignals: string[],
): PortalDownloadTriggerResult | null {
  if (!isGstr2bNotGeneratedText(normalised)) return null;

  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(target.returnType),
    state: "blocked",
    safeSignals: withSignal(safeSignals, "filed-gstr2b-not-generated"),
    safeMessage: GSTR2B_NOT_GENERATED_SAFE_MESSAGE,
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message:
        "Check the GST Portal's stated reason for this period. Retry only once the portal generates a GSTR-2B for it.",
      canResume: true,
    },
  };
}
