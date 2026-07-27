import { validateArtifactBytes } from "./artifact-validation";
import { resolveVisibleFiledReturnDownloadCandidates } from "./filed-returns-download-candidates";
import { verifyFiledReturnsDownloadTarget } from "./filed-returns-download-target";

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
  | "generation-timeout"
  | "page-period-mismatch";

export const ARTIFACT_FAILURE_MESSAGES = {
  "unsupported-target": "Pack cannot acquire that filed-return artifact.",
  "wrong-page": "Pack can acquire this artifact only from an authenticated GSTR-3B detail page.",
  "control-not-found":
    "Pack could not find exactly one filed GSTR-3B PDF control on the verified detail page.",
  "preflight-failed": "The GST Portal did not accept Pack's artifact preflight request.",
  "target-period-mismatch":
    "The GST Portal returned artifact data for a different requested return period.",
  "endpoint-unavailable":
    "The GST Portal artifact endpoint is unavailable on this authenticated page.",
  "http-error": "The GST Portal returned an unexpected response while Pack prepared the artifact.",
  "not-authenticated":
    "Your GST Portal session cannot access this filed-return artifact. Sign in again, then retry.",
  "unexpected-content":
    "The GST Portal returned content that is not a verified filed-return artifact.",
  empty: "The GST Portal returned an empty filed-return artifact.",
  "too-large": "The GST Portal returned an artifact that exceeds Pack's safe local size limit.",
  "generation-timeout": "The GST Portal did not finish generating the filed-return PDF in time.",
  "page-period-mismatch":
    "The visible GSTR-3B detail page does not match the requested financial year and period.",
} satisfies Record<ArtifactFailureReason, string>;

export function artifactFailureMessage(reason: ArtifactFailureReason): string {
  return ARTIFACT_FAILURE_MESSAGES[reason];
}

export type ArtifactResult =
  | {
      ok: true;
      state: "acquired";
      requestId: string;
      bytes: Uint8Array;
      mimeType: string;
      safeSignals: string[];
    }
  | { ok: true; state: "ready"; requestId: string; safeSignals: string[] }
  | { ok: false; requestId: string; reason: ArtifactFailureReason; safeSignals: string[] };

/** Acquires only raw, portal-produced GSTR-3B JSON bytes in the page's origin context. */
export async function acquireFiledReturnArtifact(
  documentRef: Document,
  request: ArtifactRequest,
): Promise<ArtifactResult> {
  if (request.returnType !== "GSTR-3B") return failed(request, "unsupported-target");
  const view = documentRef.defaultView;
  if (!view || view.location.origin !== GST_RETURNS_ORIGIN) return failed(request, "wrong-page");
  const pageGuard = verifyFiledReturnsDownloadTarget(
    documentRef,
    {
      actionId: request.requestId,
      artifactType: request.artifactType,
      financialYear: request.financialYear,
      period: request.period,
      returnType: request.returnType,
    },
    [],
  );
  if (pageGuard) return failed(request, "page-period-mismatch", ["page-target-unverified"]);
  const fetch = view.fetch?.bind(view);
  if (!fetch) return failed(request, "endpoint-unavailable");
  let response: Response;
  try {
    response = await fetch(
      `${GSTR3B_GET_GEN_PDF_PATH}?rtn_prd=${encodeURIComponent(request.returnPeriod)}`,
      {
        credentials: "same-origin",
      },
    );
  } catch {
    return failed(request, "endpoint-unavailable");
  }
  if (!response.ok)
    return failed(
      request,
      response.status === 401 || response.status === 403 ? "not-authenticated" : "preflight-failed",
    );
  const bytes = new Uint8Array(await response.arrayBuffer());
  const preflight = validateArtifactBytes(bytes, "JSON", request.returnPeriod);
  if (!preflight.ok) return failed(request, preflight.reason);
  if (request.artifactType === "JSON") {
    return {
      ok: true,
      state: "acquired",
      requestId: request.requestId,
      bytes,
      mimeType: preflight.mimeType,
      safeSignals: ["target-period-verified"],
    };
  }
  const candidates = resolveVisibleFiledReturnDownloadCandidates(documentRef, "GSTR-3B", "PDF");
  if (candidates.length !== 1 || !candidates[0])
    return failed(request, "control-not-found", ["target-period-verified"]);
  candidates[0].element.setAttribute("data-pack-artifact-request", request.requestId);
  return {
    ok: true,
    state: "ready",
    requestId: request.requestId,
    safeSignals: ["target-period-verified", "page-generated-pdf-ready"],
  };
}

function failed(
  request: ArtifactRequest,
  reason: ArtifactFailureReason,
  safeSignals: string[] = [],
): Extract<ArtifactResult, { ok: false }> {
  return { ok: false, requestId: request.requestId, reason, safeSignals };
}
