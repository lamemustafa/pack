import { validateArtifactBytes } from "./artifact-validation";
import {
  GSTR1_DETAIL_PATH,
  GSTR1_PAGE_GENERATED_ARTIFACTS,
  GSTR1_SUMMARY_PATH,
  GSTR1_SUMMARY_PREFLIGHT_PATH,
  GSTR2B_JSON_PATH,
  GSTR2B_ORIGIN,
  GSTR2B_PAGE_GENERATED_ARTIFACTS,
  GSTR2B_SUMMARY_PATH,
} from "./portal-artifact-endpoints";
import { normaliseText } from "./filed-returns-dom";
import { extractScopedFiledReturnsDetailIdentity } from "./filed-returns-detail-identity";
import { filedReturnDetailIdentityMatchesScope } from "./filed-returns-detail-navigation";
import { resolveVisibleFiledReturnDownloadCandidates } from "./filed-returns-download-candidates";
import { verifyFiledReturnsDownloadTarget } from "./filed-returns-download-target";

const GSTR3B_GET_GEN_PDF_PATH = "/returns/auth/api/gstr3b/getgenpdf";
const GST_RETURNS_ORIGIN = "https://return.gst.gov.in";
const PAGE_ARTIFACT_CONTROL_SELECTOR = "a, button, [role='button']";

export type ArtifactRequest = {
  returnType: "GSTR-1" | "GSTR-3B" | "GSTR-2B";
  artifactType: "PDF" | "JSON" | "EXCEL";
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
  | "response-missing"
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
  "wrong-page":
    "Pack can acquire this artifact only from the matching authenticated GST Portal page.",
  "control-not-found":
    "Pack could not find exactly one verified artifact control on the authenticated GST Portal page.",
  "preflight-failed": "The GST Portal did not accept Pack's artifact preflight request.",
  "response-missing": "Pack did not receive a usable filed-return artifact from the GST Portal.",
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
  "generation-timeout":
    "The GST Portal did not finish generating the filed-return artifact in time.",
  "page-period-mismatch":
    "The visible GST Portal page does not match the requested financial year and period.",
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
  if (request.returnType === "GSTR-2B") return acquireGstr2bArtifact(documentRef, request);
  if (request.returnType === "GSTR-1") return acquireGstr1Artifact(documentRef, request);
  if (request.artifactType === "EXCEL") return failed(request, "unsupported-target");
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

async function acquireGstr1Artifact(
  documentRef: Document,
  request: ArtifactRequest,
): Promise<ArtifactResult> {
  if (request.artifactType === "JSON") return failed(request, "unsupported-target");
  const view = documentRef.defaultView;
  if (!view || view.location.origin !== GST_RETURNS_ORIGIN) return failed(request, "wrong-page");
  const fetch = view.fetch?.bind(view);
  if (!fetch) return failed(request, "endpoint-unavailable");
  let response: Response;
  try {
    response = await fetch(
      `${GSTR1_SUMMARY_PREFLIGHT_PATH}?rtn_prd=${encodeURIComponent(request.returnPeriod)}`,
      { credentials: "same-origin" },
    );
  } catch {
    return failed(request, "endpoint-unavailable");
  }
  if (!response.ok) return failed(request, "preflight-failed");
  const preflightBytes = new Uint8Array(await response.arrayBuffer());
  if (isHtmlResponse(preflightBytes)) return failed(request, "preflight-failed");
  const preflight = validateArtifactBytes(preflightBytes, "JSON", request.returnPeriod, "GSTR-1");
  if (!preflight.ok) return failed(request, preflight.reason);
  const expectedPath = request.artifactType === "PDF" ? GSTR1_SUMMARY_PATH : GSTR1_DETAIL_PATH;
  if (view.location.pathname !== expectedPath)
    return failed(request, "wrong-page", ["target-period-verified"]);
  const descriptor = GSTR1_PAGE_GENERATED_ARTIFACTS[request.artifactType];
  const controls = resolvePageArtifactControls(documentRef, descriptor.controlText);
  if (controls.length !== 1 || !controls[0])
    return failed(request, "control-not-found", ["target-period-verified"]);
  const pageTargetMismatchSignals = gstr1PageTargetMismatchSignals(controls[0], request);
  if (pageTargetMismatchSignals.length > 0) {
    return failed(request, "page-period-mismatch", [
      "target-period-verified",
      ...pageTargetMismatchSignals,
    ]);
  }
  controls[0].setAttribute("data-pack-artifact-request", request.requestId);
  return {
    ok: true,
    state: "ready",
    requestId: request.requestId,
    safeSignals: [
      "target-period-verified",
      `page-generated-${request.artifactType.toLowerCase()}-ready`,
    ],
  };
}

function gstr1PageTargetMismatchSignals(
  downloadControl: HTMLElement,
  request: ArtifactRequest,
): string[] {
  const identity = extractScopedFiledReturnsDetailIdentity(downloadControl);
  if (!identity) return ["page-target-unverified", "page-identity-region-not-found"];
  return filedReturnDetailIdentityMatchesScope(identity, request) ? [] : ["page-target-unverified"];
}

function isHtmlResponse(bytes: Uint8Array): boolean {
  const prefix = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart().toLowerCase();
  return prefix.startsWith("<!doctype html") || prefix.startsWith("<html");
}

async function acquireGstr2bArtifact(
  documentRef: Document,
  request: ArtifactRequest,
): Promise<ArtifactResult> {
  const view = documentRef.defaultView;
  if (!view || view.location.origin !== GSTR2B_ORIGIN) return failed(request, "wrong-page");
  const fetch = view.fetch?.bind(view);
  if (!fetch) return failed(request, "endpoint-unavailable");
  let response: Response;
  try {
    response = await fetch(
      `${GSTR2B_JSON_PATH}?rtnprd=${encodeURIComponent(request.returnPeriod)}`,
      { credentials: "same-origin" },
    );
  } catch {
    return failed(request, "endpoint-unavailable");
  }
  if (!response.ok) return failed(request, "preflight-failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const preflight = validateArtifactBytes(bytes, "JSON", request.returnPeriod, "GSTR-2B");
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
  if (view.location.pathname !== GSTR2B_SUMMARY_PATH)
    return failed(request, "wrong-page", ["target-period-verified"]);
  const descriptor = GSTR2B_PAGE_GENERATED_ARTIFACTS[request.artifactType];
  const controls = resolvePageArtifactControls(documentRef, descriptor.controlText);
  if (controls.length !== 1 || !controls[0])
    return failed(request, "control-not-found", ["target-period-verified"]);
  controls[0].setAttribute("data-pack-artifact-request", request.requestId);
  return {
    ok: true,
    state: "ready",
    requestId: request.requestId,
    safeSignals: [
      "target-period-verified",
      `page-generated-${request.artifactType.toLowerCase()}-ready`,
    ],
  };
}

function resolvePageArtifactControls(documentRef: Document, canonicalLabel: string): HTMLElement[] {
  const normalisedLabel = normaliseText(canonicalLabel);
  return Array.from(
    documentRef.querySelectorAll<HTMLElement>(PAGE_ARTIFACT_CONTROL_SELECTOR),
  ).filter(
    (element) =>
      !element.querySelector(PAGE_ARTIFACT_CONTROL_SELECTOR) &&
      normaliseText(element.textContent || "").includes(normalisedLabel),
  );
}

function failed(
  request: ArtifactRequest,
  reason: ArtifactFailureReason,
  safeSignals: string[] = [],
): Extract<ArtifactResult, { ok: false }> {
  return { ok: false, requestId: request.requestId, reason, safeSignals };
}
