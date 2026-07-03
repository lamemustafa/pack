import type { FiledReturnsDownloadTarget, PortalDownloadTriggerResult } from "../../core/contracts";
import { extractFiledReturnsDetailIdentity } from "./filed-returns-detail-identity";
import { verifyFiledReturnsDownloadTarget } from "./filed-returns-download-target";
import { toPortalReturnPeriod } from "./filed-returns-return-period";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
const GST_RETURNS_ORIGIN = "https://return.gst.gov.in";
const GENERATED_PDF_API_PATH = "/returns/auth/api/gstr3b/getgenpdf";
const TAX_PAYABLE_API_PATH = "/returns/auth/api/gstr3b/taxpayble";

export type FiledGstr3bDirectDownloadRequestResolution =
  | {
      ok: true;
      pdfPath: string;
      preflightPath: string;
      returnPeriod: string;
      safeSignals: string[];
    }
  | { ok: false; result: PortalDownloadTriggerResult };

export type FiledGstr3bDirectDownloadProbeResult =
  | {
      state: "available";
      safeSignals: string[];
      status: number;
    }
  | {
      state: "unavailable" | "blocked";
      safeSignals: string[];
      status?: number;
      safeMessage: string;
    };

export function resolveFiledGstr3bGeneratedPdfApiRequest(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
): FiledGstr3bDirectDownloadRequestResolution {
  if (target.artifactType && target.artifactType !== "PDF") {
    return {
      ok: false,
      result: {
        connectorId: "gst",
        scopeId: FILED_RETURNS_SCOPE_ID,
        state: "blocked",
        safeSignals: ["filed-gstr3b-direct-download-artifact-rejected"],
        safeMessage:
          "Pack will not build a direct filed GSTR-3B PDF request for a non-PDF artifact.",
      },
    };
  }

  if (target.returnType !== "GSTR-3B") {
    return {
      ok: false,
      result: {
        connectorId: "gst",
        scopeId: FILED_RETURNS_SCOPE_ID,
        state: "blocked",
        safeSignals: ["filed-gstr3b-direct-download-return-type-rejected"],
        safeMessage:
          "Pack will not build a direct filed-return PDF request for this return type until its GST Portal endpoint is reviewed.",
      },
    };
  }

  const pageGuard = detectFiledGstr3bDetailApiContext(documentRef);
  if (!pageGuard.ok) {
    return {
      ok: false,
      result: {
        connectorId: "gst",
        scopeId: FILED_RETURNS_SCOPE_ID,
        state: "unsupported-page",
        safeSignals: pageGuard.safeSignals,
        safeMessage:
          "Pack will only build a direct filed GSTR-3B PDF request from the authenticated GST GSTR-3B detail page.",
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          message: "Open the filed GSTR-3B detail page for the requested period.",
          canResume: true,
        },
      },
    };
  }

  const identity = extractFiledReturnsDetailIdentity(documentRef);
  const baseSignals = [...pageGuard.safeSignals, ...identity.safeSignals];
  if (!target.actionId.trim()) {
    return {
      ok: false,
      result: {
        connectorId: "gst",
        scopeId: FILED_RETURNS_SCOPE_ID,
        state: "blocked",
        safeSignals: [...baseSignals, "filed-gstr3b-direct-download-action-id-missing"],
        safeMessage:
          "Pack will not build a direct filed GSTR-3B PDF request without a local action identifier.",
      },
    };
  }

  const returnPeriod = toPortalReturnPeriod(target.period, target.financialYear);
  if (!returnPeriod) {
    return {
      ok: false,
      result: {
        connectorId: "gst",
        scopeId: FILED_RETURNS_SCOPE_ID,
        state: "blocked",
        safeSignals: [...baseSignals, "filed-gstr3b-return-period-invalid"],
        safeMessage:
          "Pack could not derive the GST portal return period for the requested filed GSTR-3B download.",
      },
    };
  }

  const targetGuard = verifyDirectDownloadTarget(documentRef, target, baseSignals);
  if (targetGuard) return { ok: false, result: targetGuard };

  return {
    ok: true,
    pdfPath: buildFiledGstr3bGeneratedPdfApiPath(returnPeriod),
    preflightPath: buildFiledGstr3bTaxPayableApiPath(returnPeriod),
    returnPeriod,
    safeSignals: [
      ...baseSignals,
      ...buildStoredReturnPeriodMatchSignals(documentRef, returnPeriod),
      "filed-gstr3b-direct-download-path-built",
    ],
  };
}

export function buildFiledGstr3bGeneratedPdfApiPath(returnPeriod: string): string {
  return `${GENERATED_PDF_API_PATH}?rtn_prd=${encodeURIComponent(returnPeriod)}`;
}

export function buildFiledGstr3bTaxPayableApiPath(returnPeriod: string): string {
  return `${TAX_PAYABLE_API_PATH}?rtn_prd=${encodeURIComponent(returnPeriod)}`;
}

function detectFiledGstr3bDetailApiContext(documentRef: Document): {
  ok: boolean;
  safeSignals: string[];
} {
  const location = documentRef.defaultView?.location;
  const safeSignals: string[] = [];

  if (location?.origin === GST_RETURNS_ORIGIN) safeSignals.push("gst-returns-origin");
  if (/\/returns\/auth\/gstr3b$/i.test(location?.pathname ?? "")) {
    safeSignals.push("gstr-3b-detail-route");
  }

  return {
    ok: safeSignals.includes("gst-returns-origin") && safeSignals.includes("gstr-3b-detail-route"),
    safeSignals,
  };
}

function verifyDirectDownloadTarget(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
  baseSignals: readonly string[],
): PortalDownloadTriggerResult | null {
  const identity = extractFiledReturnsDetailIdentity(documentRef);
  if (identity.period && identity.financialYear) {
    return verifyFiledReturnsDownloadTarget(documentRef, target, baseSignals);
  }

  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "blocked",
    safeSignals: [
      ...baseSignals,
      "filed-gstr3b-direct-download-visible-identity-missing",
      "filed-return-download-target-mismatch",
    ],
    safeMessage:
      "Pack will not build a direct filed GSTR-3B PDF request until the visible GST detail page exposes the requested return period and financial year.",
    userAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message:
        "Open the filed GSTR-3B detail page for the requested period and financial year, then start Pack again.",
      canResume: true,
    },
  };
}

function buildStoredReturnPeriodMatchSignals(
  documentRef: Document,
  returnPeriod: string,
): string[] {
  return readStoredReturnPeriod(documentRef) === returnPeriod
    ? ["filed-gstr3b-direct-download-storage-period-matched"]
    : [];
}

function readStoredReturnPeriod(documentRef: Document): string | null {
  try {
    return documentRef.defaultView?.localStorage.getItem("rtn_prd") || null;
  } catch {
    return null;
  }
}
