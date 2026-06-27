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

  const targetGuard = verifyDirectDownloadTarget(documentRef, target, baseSignals, returnPeriod);
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

export async function probeFiledGstr3bGeneratedPdfApi(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
): Promise<FiledGstr3bDirectDownloadProbeResult> {
  const resolved = resolveFiledGstr3bGeneratedPdfApiRequest(documentRef, target);
  if (!resolved.ok) {
    return {
      state: "blocked",
      safeSignals: resolved.result.safeSignals,
      safeMessage: resolved.result.safeMessage,
    };
  }

  const fetchFn = documentRef.defaultView?.fetch;
  if (!fetchFn) {
    return {
      state: "blocked",
      safeSignals: [...resolved.safeSignals, "filed-gstr3b-direct-download-fetch-unavailable"],
      safeMessage: "Pack could not access the GST page fetch runtime for the direct PDF probe.",
    };
  }

  try {
    const response = await fetchFn(resolved.pdfPath, {
      credentials: "same-origin",
      headers: { Accept: "application/pdf,application/octet-stream,*/*" },
      method: "GET",
    });
    await cancelResponseBody(response);

    return {
      state: response.ok ? "available" : "unavailable",
      status: response.status,
      safeSignals: [
        ...resolved.safeSignals,
        "filed-gstr3b-direct-download-probed",
        ...(response.headers.get("content-type")
          ? ["filed-gstr3b-direct-download-content-type-present"]
          : []),
        ...(response.headers.get("content-length")
          ? ["filed-gstr3b-direct-download-content-length-present"]
          : []),
        ...(response.headers.get("content-disposition")
          ? ["filed-gstr3b-direct-download-disposition-present"]
          : []),
      ],
      safeMessage: response.ok
        ? "The GST filed GSTR-3B PDF endpoint is reachable for the requested period."
        : "The GST filed GSTR-3B PDF endpoint did not return a successful metadata response for the requested period.",
    };
  } catch {
    return {
      state: "unavailable",
      safeSignals: [...resolved.safeSignals, "filed-gstr3b-direct-download-probe-failed"],
      safeMessage:
        "The GST filed GSTR-3B PDF endpoint could not be probed from the authenticated page.",
    };
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Header-only probes should never fail because a response stream cannot be cancelled.
  }
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
  returnPeriod: string,
): PortalDownloadTriggerResult | null {
  const identity = extractFiledReturnsDetailIdentity(documentRef);
  if (identity.period || identity.financialYear) {
    return verifyFiledReturnsDownloadTarget(documentRef, target, baseSignals);
  }

  const storedReturnPeriod = readStoredReturnPeriod(documentRef);
  if (storedReturnPeriod === returnPeriod) return null;

  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "blocked",
    safeSignals: [
      ...baseSignals,
      storedReturnPeriod
        ? "filed-gstr3b-direct-download-storage-period-mismatch"
        : "filed-gstr3b-direct-download-storage-period-missing",
      "filed-return-download-target-mismatch",
    ],
    safeMessage:
      "Pack will not build a direct filed GSTR-3B PDF request because the GST detail route does not expose a matching return period.",
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
