import type { FiledReturnsDownloadTarget, PortalDownloadTriggerResult } from "../../core/contracts";
import { extractFiledReturnsDetailIdentity } from "./filed-returns-detail-identity";
import { filedReturnScopeId } from "./filed-returns-return-descriptors";

export function verifyFiledReturnsDownloadTarget(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
  baseSignals: readonly string[],
): PortalDownloadTriggerResult | null {
  const identity = extractFiledReturnsDetailIdentity(documentRef, target.returnType);
  const mismatches = [
    !identity.returnType || identity.returnType !== target.returnType,
    !identity.period || identity.period !== target.period,
    !identity.financialYear || identity.financialYear !== target.financialYear,
  ];
  if (!mismatches.some(Boolean)) return null;

  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(target.returnType),
    state: "blocked",
    safeSignals: [
      ...baseSignals,
      ...identity.safeSignals,
      !identity.returnType ? "filed-return-detail-type-missing" : "",
      !identity.period ? "filed-return-detail-period-missing" : "",
      !identity.financialYear ? "filed-return-detail-financial-year-missing" : "",
      "filed-return-download-target-mismatch",
    ].filter(Boolean),
    safeMessage: `Pack will not click this filed ${target.returnType} download because the visible GST detail page does not match the requested return type, period, and financial year.`,
    userAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: `Open the filed ${target.returnType} detail page for the requested period and financial year, then start Pack again.`,
      canResume: true,
    },
  };
}
