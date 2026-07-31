import { browser } from "wxt/browser";
import { validateArtifactBytes } from "../connectors/gst/artifact-validation";
import type { FiledReturnsDownloadDiagnostic } from "../connectors/gst/filed-returns-contracts";
import { downloadAcquiredArtifact } from "./artifact-download";

type JsonReturnType = "GSTR-3B" | "GSTR-2B";
type JsonAcquisitionResult =
  | {
      ok: true;
      downloadDiagnostic?: FiledReturnsDownloadDiagnostic;
      safeMessage?: string;
      safeSignals: string[];
    }
  | { ok: false; reason: string; safeSignals: string[] };

export async function acquireFiledReturnJsonInMainWorld(input: {
  deliver?: (input: { base64: string; mimeType: string }) => Promise<JsonAcquisitionResult>;
  filename: string;
  onStarted?: (downloadId: number) => Promise<void>;
  onStartCheckpointFailed?: (downloadId: number) => Promise<void>;
  requestId: string;
  returnPeriod: string;
  returnType: JsonReturnType;
  tabId: number;
}): Promise<JsonAcquisitionResult> {
  try {
    const [injection] = await browser.scripting.executeScript({
      args: [{ returnPeriod: input.returnPeriod, returnType: input.returnType }],
      func: fetchFiledReturnJsonInMainWorld,
      target: { tabId: input.tabId },
      world: "MAIN",
    });
    const captured = injection?.result;
    if (!captured?.ok) {
      return { ok: false, reason: captured?.reason ?? "endpoint-unavailable", safeSignals: [] };
    }
    const bytes = Uint8Array.from(atob(captured.base64), (value) => value.charCodeAt(0));
    const validation = validateArtifactBytes(bytes, "JSON", input.returnPeriod, input.returnType);
    if (!validation.ok) return { ok: false, reason: validation.reason, safeSignals: [] };
    if (input.deliver) {
      return input.deliver({ base64: captured.base64, mimeType: validation.mimeType });
    }
    const delivery = await downloadAcquiredArtifact({
      requestId: input.requestId,
      base64: captured.base64,
      filename: input.filename,
      mimeType: validation.mimeType,
      ...(input.onStarted ? { onStarted: input.onStarted } : {}),
      ...(input.onStartCheckpointFailed
        ? { onStartCheckpointFailed: input.onStartCheckpointFailed }
        : {}),
    });
    return delivery.ok
      ? {
          ok: true,
          safeSignals: [...delivery.safeSignals, "extension-download-complete"],
          ...(delivery.safeMessage ? { safeMessage: delivery.safeMessage } : {}),
        }
      : { ok: false, reason: delivery.reason, safeSignals: delivery.safeSignals };
  } catch {
    return { ok: false, reason: "endpoint-unavailable", safeSignals: [] };
  }
}

/**
 * Runs only as a service-worker-owned MAIN-world execution result. It must stay
 * self-contained: no content-script runtime message, page postMessage, or
 * storage path may carry the returned portal bytes.
 */
async function fetchFiledReturnJsonInMainWorld(input: {
  returnPeriod: string;
  returnType: JsonReturnType;
}): Promise<{ ok: true; base64: string } | { ok: false; reason: string }> {
  const endpoint =
    input.returnType === "GSTR-3B"
      ? {
          origin: "https://return.gst.gov.in",
          path: "/returns/auth/api/gstr3b/getgenpdf",
          parameter: "rtn_prd",
        }
      : {
          origin: "https://gstr2b.gst.gov.in",
          path: "/gstr2b/auth/api/gstr2b/getjson",
          parameter: "rtnprd",
        };
  if (globalThis.location.origin !== endpoint.origin) return { ok: false, reason: "wrong-page" };
  let response: Response;
  try {
    response = await globalThis.fetch(
      `${endpoint.path}?${endpoint.parameter}=${encodeURIComponent(input.returnPeriod)}`,
      { credentials: "same-origin" },
    );
  } catch {
    return { ok: false, reason: "endpoint-unavailable" };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason:
        response.status === 401 || response.status === 403
          ? "not-authenticated"
          : "preflight-failed",
    };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return { ok: true, base64: btoa(binary) };
}
