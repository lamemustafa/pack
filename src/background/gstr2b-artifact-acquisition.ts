import { browser } from "wxt/browser";
import { validateArtifactBytes } from "../connectors/gst/artifact-validation";
import { capturePortalPdfBlob } from "../connectors/gst/portal-blob-shim";
import { downloadAcquiredArtifact, installPortalBlobDownloadSafetyNet } from "./artifact-download";

const MIME_TYPES = {
  EXCEL: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  PDF: "application/pdf",
} as const;

export async function acquireGstr2bPageGeneratedArtifact(input: {
  artifactType: "PDF" | "EXCEL";
  filename: string;
  onStarted?: (downloadId: number) => Promise<void>;
  onStartCheckpointFailed?: (downloadId: number) => Promise<void>;
  requestId: string;
  returnPeriod: string;
  tabId: number;
}): Promise<
  | { ok: true; safeMessage?: string; safeSignals: string[] }
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
      "GSTR-2B",
    );
    if (!validation.ok) return { ok: false, reason: validation.reason, safeSignals: [] };
    const delivery = await downloadAcquiredArtifact({
      base64: captured.base64,
      filename: input.filename,
      mimeType: validation.mimeType,
      requestId: input.requestId,
      ...(input.onStarted ? { onStarted: input.onStarted } : {}),
      ...(input.onStartCheckpointFailed
        ? { onStartCheckpointFailed: input.onStartCheckpointFailed }
        : {}),
    });
    return delivery.ok
      ? {
          ok: true,
          safeSignals: [
            ...captured.safeSignals,
            ...delivery.safeSignals,
            "extension-download-complete",
          ],
          ...(delivery.safeMessage ? { safeMessage: delivery.safeMessage } : {}),
        }
      : { ok: false, reason: delivery.reason, safeSignals: delivery.safeSignals };
  } finally {
    removeSafetyNet();
  }
}
