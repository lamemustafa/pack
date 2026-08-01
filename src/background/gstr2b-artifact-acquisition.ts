import { browser } from "wxt/browser";
import { validateArtifactBytes } from "../connectors/gst/artifact-validation";
import {
  capturePortalPdfBlob,
  MAX_PORTAL_BLOB_BYTES,
  type PortalBlobShimResult,
} from "../connectors/gst/portal-blob-shim";
import { installPortalBlobDownloadSafetyNet } from "./artifact-download";

const MIME_TYPES = {
  EXCEL: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  PDF: "application/pdf",
} as const;

export async function acquirePageGeneratedArtifact(input: {
  artifactType: "PDF" | "EXCEL";
  financialYear: string;
  period: string;
  requestId: string;
  returnPeriod: string;
  returnType: "GSTR-1" | "GSTR-2B";
  tabId: number;
}): Promise<
  | { ok: true; bytes: Uint8Array; mimeType: string; safeSignals: string[] }
  | { ok: false; reason: string; safeSignals: string[] }
> {
  const safetyNet = installPortalBlobDownloadSafetyNet(input.tabId);
  try {
    let captured: PortalBlobShimResult | undefined;
    try {
      const [injection] = await browser.scripting.executeScript({
        args: [
          {
            controlSelector: `[data-pack-artifact-request="${input.requestId}"]`,
            expectedMime: MIME_TYPES[input.artifactType],
            maxPortalBlobBytes: MAX_PORTAL_BLOB_BYTES,
            expectedTarget: {
              financialYear: input.financialYear,
              period: input.period,
              returnType: input.returnType,
            },
          },
        ],
        func: capturePortalPdfBlob,
        target: { tabId: input.tabId },
        world: "MAIN",
      });
      captured = injection?.result as PortalBlobShimResult | undefined;
    } catch {
      return { ok: false, reason: "main-world-execution-failed", safeSignals: [] };
    }
    if (!captured?.ok)
      return {
        ok: false,
        reason: captured?.reason ?? "main-world-execution-failed",
        safeSignals: captured?.safeSignals ?? [],
      };
    await safetyNet.bind(captured.blobUrl);
    const bytes = Uint8Array.from(atob(captured.base64), (value) => value.charCodeAt(0));
    const validation = validateArtifactBytes(
      bytes,
      input.artifactType,
      input.returnPeriod,
      input.returnType,
    );
    if (!validation.ok) return { ok: false, reason: validation.reason, safeSignals: [] };
    return { ok: true, bytes, mimeType: validation.mimeType, safeSignals: captured.safeSignals };
  } finally {
    safetyNet.remove();
  }
}
