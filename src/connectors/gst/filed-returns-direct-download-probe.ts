import type { FiledReturnsDownloadTarget, PortalDownloadTriggerResult } from "../../core/contracts";
import {
  type FiledGstr3bDirectDownloadRequestResolution,
  type FiledGstr3bDirectDownloadProbeResult,
  resolveFiledGstr3bGeneratedPdfApiRequest,
} from "./filed-returns-direct-download";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";

export async function resolveFiledGstr3bVerifiedPdfDownloadRequest(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
): Promise<FiledGstr3bDirectDownloadRequestResolution> {
  const resolved = resolveFiledGstr3bGeneratedPdfApiRequest(documentRef, target);
  if (!resolved.ok) return resolved;

  const probe = await probeResolvedFiledGstr3bGeneratedPdfApi(documentRef, resolved);
  if (probe.state !== "available") {
    return {
      ok: false,
      result: buildDirectDownloadBlockedResult(probe.safeSignals, probe.safeMessage),
    };
  }

  return {
    ...resolved,
    safeSignals: [...probe.safeSignals, "filed-gstr3b-direct-download-probe-accepted"],
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

  return probeResolvedFiledGstr3bGeneratedPdfApi(documentRef, resolved);
}

async function probeResolvedFiledGstr3bGeneratedPdfApi(
  documentRef: Document,
  resolved: Extract<FiledGstr3bDirectDownloadRequestResolution, { ok: true }>,
): Promise<FiledGstr3bDirectDownloadProbeResult> {
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
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (response.ok && isContradictoryNonPdfContentType(contentType)) {
      return {
        state: "unavailable",
        status: response.status,
        safeSignals: [
          ...resolved.safeSignals,
          "filed-gstr3b-direct-download-probed",
          "filed-gstr3b-direct-download-content-type-present",
          "filed-gstr3b-direct-download-non-pdf-response",
        ],
        safeMessage:
          "The GST filed GSTR-3B endpoint did not expose a PDF response for the requested period.",
      };
    }

    return {
      state: response.ok ? "available" : "unavailable",
      status: response.status,
      safeSignals: [
        ...resolved.safeSignals,
        "filed-gstr3b-direct-download-probed",
        ...(contentType ? ["filed-gstr3b-direct-download-content-type-present"] : []),
        ...(response.ok ? [] : ["filed-gstr3b-direct-download-status-rejected"]),
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
      safeSignals: [
        ...resolved.safeSignals,
        "filed-gstr3b-direct-download-probe-failed",
        "filed-gstr3b-direct-download-fetch-failed",
      ],
      safeMessage:
        "The GST filed GSTR-3B PDF endpoint could not be probed from the authenticated page.",
    };
  }
}

function isContradictoryNonPdfContentType(contentType: string): boolean {
  if (!contentType) return false;
  if (contentType.includes("pdf")) return false;
  return (
    contentType.startsWith("text/") ||
    contentType.includes("html") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("javascript")
  );
}

function buildDirectDownloadBlockedResult(
  safeSignals: string[],
  safeMessage: string,
): PortalDownloadTriggerResult {
  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "blocked",
    safeSignals,
    safeMessage,
  };
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Header-only probes should never fail because a response stream cannot be cancelled.
  }
}
