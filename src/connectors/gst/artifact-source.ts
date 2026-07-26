import { validateArtifactBytes } from "./artifact-validation";
import { detectFiledReturnDetailPage } from "./filed-returns-detail-page-guard";

const GSTR3B_GET_GEN_PDF_PATH = "/returns/auth/api/gstr3b/getgenpdf";
const GST_RETURNS_ORIGIN = "https://return.gst.gov.in";

export type ArtifactRequest = {
  returnType: "GSTR-3B";
  artifactType: "PDF" | "JSON";
  financialYear: string;
  period: string;
  returnPeriod: string;
  requestId: string;
};

export type ArtifactFailureReason =
  | "unsupported-target"
  | "wrong-page"
  | "control-not-found"
  | "preflight-failed"
  | "target-period-mismatch"
  | "endpoint-unavailable"
  | "http-error"
  | "not-authenticated"
  | "unexpected-content"
  | "empty"
  | "too-large"
  | "generation-timeout";

export type ArtifactResult =
  | { ok: true; requestId: string; bytes: Uint8Array; mimeType: string; safeSignals: string[] }
  | { ok: false; requestId: string; reason: ArtifactFailureReason; safeSignals: string[] };

/** Acquires only raw, portal-produced GSTR-3B JSON bytes in the page's origin context. */
export async function acquireFiledReturnArtifact(
  documentRef: Document,
  request: ArtifactRequest,
): Promise<ArtifactResult> {
  if (request.returnType !== "GSTR-3B") return failed(request, "unsupported-target");
  const view = documentRef.defaultView;
  if (!view || view.location.origin !== GST_RETURNS_ORIGIN) return failed(request, "wrong-page");
  const page = detectFiledReturnDetailPage(documentRef, "GSTR-3B", "PDF");
  if (!page.isDetailPage && !/\/returns\/auth\/gstr3b$/i.test(view.location.pathname)) {
    return failed(request, "wrong-page");
  }
  const fetch = view.fetch?.bind(view);
  if (!fetch) return failed(request, "endpoint-unavailable");
  let response: Response;
  try {
    response = await fetch(`${GSTR3B_GET_GEN_PDF_PATH}?rtn_prd=${encodeURIComponent(request.returnPeriod)}`, {
      credentials: "same-origin",
    });
  } catch {
    return failed(request, "endpoint-unavailable");
  }
  if (!response.ok) return failed(request, response.status === 401 || response.status === 403 ? "not-authenticated" : "preflight-failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const preflight = validateArtifactBytes(bytes, "JSON", request.returnPeriod);
  if (!preflight.ok) return failed(request, preflight.reason);
  if (request.artifactType === "JSON") {
    return { ok: true, requestId: request.requestId, bytes, mimeType: preflight.mimeType, safeSignals: ["target-period-verified"] };
  }
  return failed(request, "control-not-found", ["target-period-verified", "page-generated-pdf-required"]);
}

function failed(
  request: ArtifactRequest,
  reason: ArtifactFailureReason,
  safeSignals: string[] = [],
): Extract<ArtifactResult, { ok: false }> {
  return { ok: false, requestId: request.requestId, reason, safeSignals };
}
