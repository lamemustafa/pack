import type { PortalDownloadTriggerResult } from "../../core/contracts";
import { delay } from "../../core/time";
import type { FiledReturnsDownloadTarget } from "./filed-returns-contracts";
import { filedReturnScopeId } from "./filed-returns-return-descriptors";
import { verifyFiledReturnsDownloadTarget } from "./filed-returns-download-target";

const GSTR1_EXCEL_POST_CLICK_BLOCKED_WAIT_MS = 800;
const GSTR1_EXCEL_POST_CLICK_BLOCKED_POLL_MS = 100;

export async function waitForPostClickBlockedState(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
  safeSignals: string[],
): Promise<PortalDownloadTriggerResult | null> {
  if (target.returnType !== "GSTR-1" || target.artifactType !== "EXCEL") return null;

  const startedAt = Date.now();
  do {
    const blockedState = detectPostClickBlockedState(documentRef, target, safeSignals);
    if (blockedState) return blockedState;
    await delay(GSTR1_EXCEL_POST_CLICK_BLOCKED_POLL_MS);
  } while (Date.now() - startedAt < GSTR1_EXCEL_POST_CLICK_BLOCKED_WAIT_MS);

  return null;
}

export function detectPostClickBlockedState(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
  safeSignals: string[],
): PortalDownloadTriggerResult | null {
  if (target.returnType !== "GSTR-1" || target.artifactType !== "EXCEL") return null;

  const text = documentRef.body?.innerText ?? documentRef.body?.textContent ?? "";
  const normalised = text.replace(/\s+/g, " ").trim();
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
    safeSignals: [
      ...safeSignals,
      ...(safeSignals.includes("filed-gstr1-excel-no-details-available")
        ? []
        : ["filed-gstr1-excel-no-details-available"]),
    ],
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
