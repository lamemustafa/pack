import type { FiledReturnsDownloadTarget, PortalDownloadTriggerResult } from "../../core/contracts";
import { extractFiledReturnsDetailIdentity } from "./filed-returns-detail-identity";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";

export function verifyFiledReturnsDownloadTarget(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
  baseSignals: readonly string[],
): PortalDownloadTriggerResult | null {
  const identity = extractFiledReturnsDetailIdentity(documentRef);
  const mismatches = [
    !identity.period || identity.period !== target.period,
    !identity.financialYear || identity.financialYear !== target.financialYear,
  ];
  if (!mismatches.some(Boolean)) return null;

  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "blocked",
    safeSignals: [
      ...baseSignals,
      ...identity.safeSignals,
      !identity.period ? "filed-return-detail-period-missing" : "",
      !identity.financialYear ? "filed-return-detail-financial-year-missing" : "",
      "filed-return-download-target-mismatch",
    ].filter(Boolean),
    safeMessage:
      "Pack will not click this filed GSTR-3B download because the visible GST detail page does not match the requested period and financial year.",
    userAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message:
        "Open the filed GSTR-3B detail page for the requested period and financial year, then start Pack again.",
      canResume: true,
    },
  };
}
