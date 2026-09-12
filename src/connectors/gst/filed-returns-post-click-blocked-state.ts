import type { PortalDownloadTriggerResult } from "../../core/contracts";
import type { FiledReturnsDownloadTarget } from "./filed-returns-contracts";
import { normaliseText } from "./filed-returns-dom";
import { filedReturnScopeId } from "./filed-returns-return-descriptors";
import { verifyFiledReturnsDownloadTarget } from "./filed-returns-download-target";
import { readDocumentText, verifyVisibleGstr2bPeriod } from "./gstr2b-summary";

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

function withSignal(safeSignals: string[], signal: string): string[] {
  return safeSignals.includes(signal) ? [...safeSignals] : [...safeSignals, signal];
}

export function detectPostClickBlockedState(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
  safeSignals: string[],
): PortalDownloadTriggerResult | null {
  // The same reading the observation path uses. This was a second, subtly different copy: it
  // skipped the lower-casing, so a case-sensitive label pattern could not have matched against it.
  const normalised = normaliseText(readDocumentText(documentRef));
  if (target.returnType === "GSTR-1" && target.artifactType === "EXCEL") {
    return detectGstr1ExcelNoDetails(documentRef, normalised, target, safeSignals);
  }
  if (target.returnType === "GSTR-2B") {
    return detectGstr2bNotGenerated(documentRef, normalised, target, safeSignals);
  }
  return null;
}

function detectGstr1ExcelNoDetails(
  documentRef: Document,
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

  // A dialog on screen is not bound to this target by being on screen. The detail route does not
  // change per period, and a dialog left standing by an earlier target would otherwise mark this
  // artifact unavailable -- letting a composite or full-year run carry on having silently omitted
  // an artifact the portal never declined for it.
  //
  // This is the same guard that binds a download click, asked the same question: the visible page
  // must be this return type, this period, this financial year. Recording a refusal resolves the
  // target outright and no artifact follows to corroborate it, so it is held to the same bar. It
  // fails closed -- an unreadable detail header is "could not determine", never "matches".
  if (verifyFiledReturnsDownloadTarget(documentRef, target, [])) return null;

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
  documentRef: Document,
  normalised: string,
  target: FiledReturnsDownloadTarget,
  safeSignals: string[],
): PortalDownloadTriggerResult | null {
  if (!isGstr2bNotGeneratedText(normalised)) return null;

  // The refusal panel is not bound to the target by the fact that it is on screen. The summary
  // route does not change per period and keeps rendering the panel -- and the header naming the
  // period it belongs to -- until a new search settles, so a stale panel will answer for whichever
  // target asks. Recording it resolves that target outright, with no artifact to corroborate it
  // afterwards, which makes the visible header the whole of the evidence.
  //
  // A target is a scope with an action id, so the same guard the observation path uses applies
  // unchanged here. It fails closed: an unreadable header is "could not determine".
  if (verifyVisibleGstr2bPeriod(documentRef, normalised, target)) return null;

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
