import { browser } from "wxt/browser";
import { validateArtifactBytes } from "../connectors/gst/artifact-validation";
import { capturePortalPdfBlob } from "../connectors/gst/portal-blob-shim";
import { installPortalBlobDownloadSafetyNet } from "./artifact-download";

const MIME_TYPES = {
  EXCEL: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  PDF: "application/pdf",
} as const;

export async function acquirePageGeneratedArtifact(input: {
  artifactType: "PDF" | "EXCEL";
  requestId: string;
  returnPeriod: string;
  returnType: "GSTR-1" | "GSTR-2B";
  tabId: number;
}): Promise<
  | { ok: true; bytes: Uint8Array; mimeType: string; safeSignals: string[] }
  | { ok: false; reason: string; safeSignals: string[] }
> {
  const removeSafetyNet = installPortalBlobDownloadSafetyNet(input.tabId);
  try {
    const [injection] = await browser.scripting.executeScript({
      args: [
        {
          controlSelector: `[data-pack-artifact-request="${input.requestId}"]`,
          expectedMime: MIME_TYPES[input.artifactType],
        },
      ],
      func: capturePortalPdfBlob,
      target: { tabId: input.tabId },
      world: "MAIN",
    });
    const captured = injection?.result;
    if (!captured?.ok)
      return { ok: false, reason: captured?.reason ?? "generation-timeout", safeSignals: [] };
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
    removeSafetyNet();
  }
}
