import { browser } from "wxt/browser";
import { validateArtifactBytes } from "../connectors/gst/artifact-validation";
import { capturePortalPdfBlob } from "../connectors/gst/portal-blob-shim";
import { downloadAcquiredArtifact, installPortalBlobDownloadSafetyNet } from "./artifact-download";

export async function acquireGstr3bPdfAfterPreflight(input: {
  tabId: number;
  requestId: string;
  returnPeriod: string;
  filename: string;
  onStarted?: (downloadId: number) => Promise<void>;
}): Promise<{ ok: true; safeSignals: string[] } | { ok: false; reason: string }> {
  const removeSafetyNet = installPortalBlobDownloadSafetyNet(input.tabId);
  try {
    const [injection] = await browser.scripting.executeScript({
      args: [{ controlSelector: `[data-pack-artifact-request="${input.requestId}"]` }],
      func: capturePortalPdfBlob,
      target: { tabId: input.tabId },
      world: "MAIN",
    });
    const captured = injection?.result;
    if (!captured?.ok) return { ok: false, reason: captured?.reason ?? "generation-timeout" };
    const bytes = Uint8Array.from(atob(captured.base64), (value) => value.charCodeAt(0));
    const validation = validateArtifactBytes(bytes, "PDF", input.returnPeriod);
    if (!validation.ok) return { ok: false, reason: validation.reason };
    const delivery = await downloadAcquiredArtifact({
      requestId: input.requestId,
      base64: captured.base64,
      filename: input.filename,
      mimeType: validation.mimeType,
      ...(input.onStarted ? { onStarted: input.onStarted } : {}),
    });
    return delivery.ok
      ? { ok: true, safeSignals: [...captured.safeSignals, "extension-download-complete"] }
      : { ok: false, reason: delivery.reason };
  } finally {
    removeSafetyNet();
  }
}
