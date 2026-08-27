import { browser } from "wxt/browser";
import { validateArtifactBytes } from "../connectors/gst/artifact-validation";
import type { FiledReturnsDownloadDiagnostic } from "../connectors/gst/filed-returns-contracts";
import {
  capturePortalPdfBlob,
  MAX_PORTAL_BLOB_BYTES,
  type PortalBlobShimResult,
} from "../connectors/gst/portal-blob-shim";
import { downloadAcquiredArtifact, installPortalBlobDownloadSafetyNet } from "./artifact-download";

type Gstr3bPdfDeliveryResult =
  | {
      ok: true;
      downloadDiagnostic?: FiledReturnsDownloadDiagnostic;
      downloadId?: number;
      safeMessage?: string;
      safeSignals: string[];
    }
  | { ok: false; reason: string; safeMessage?: string; safeSignals: string[] };

export async function acquireGstr3bPdfAfterPreflight(input: {
  deliver?: (input: { base64: string; mimeType: string }) => Promise<Gstr3bPdfDeliveryResult>;
  financialYear: string;
  tabId: number;
  requestId: string;
  period: string;
  returnPeriod: string;
  filename: string;
  onStarted?: (downloadId: number) => Promise<void>;
  onStartCheckpointFailed?: (downloadId: number) => Promise<void>;
}): Promise<Gstr3bPdfDeliveryResult> {
  const safetyNet = installPortalBlobDownloadSafetyNet(input.tabId);
  try {
    let captured: PortalBlobShimResult | undefined;
    try {
      const [injection] = await browser.scripting.executeScript({
        args: [
          {
            controlSelector: `[data-pack-artifact-request="${input.requestId}"]`,
            expectedMime: "application/pdf",
            maxPortalBlobBytes: MAX_PORTAL_BLOB_BYTES,
            expectedTarget: {
              financialYear: input.financialYear,
              period: input.period,
              returnType: "GSTR-3B",
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
    if (!captured?.ok) {
      return {
        ok: false,
        reason: captured?.reason ?? "main-world-execution-failed",
        safeSignals: captured?.safeSignals ?? [],
      };
    }
    await safetyNet.bind(captured.blobUrl);
    const bytes = Uint8Array.from(atob(captured.base64), (value) => value.charCodeAt(0));
    const validation = validateArtifactBytes(bytes, "PDF", input.returnPeriod);
    if (!validation.ok) return { ok: false, reason: validation.reason, safeSignals: [] };
    if (input.deliver) {
      try {
        const delivery = await input.deliver({
          base64: captured.base64,
          mimeType: validation.mimeType,
        });
        return {
          ...delivery,
          safeSignals: [...captured.safeSignals, ...delivery.safeSignals],
        };
      } catch {
        return { ok: false, reason: "delivery-unconfirmed", safeSignals: [] };
      }
    }
    let delivery;
    try {
      delivery = await downloadAcquiredArtifact({
        requestId: input.requestId,
        base64: captured.base64,
        filename: input.filename,
        mimeType: validation.mimeType,
        ...(input.onStarted ? { onStarted: input.onStarted } : {}),
        ...(input.onStartCheckpointFailed
          ? { onStartCheckpointFailed: input.onStartCheckpointFailed }
          : {}),
      });
    } catch {
      return { ok: false, reason: "delivery-unconfirmed", safeSignals: [] };
    }
    return delivery.ok
      ? {
          ok: true,
          downloadId: delivery.downloadId,
          safeSignals: [...captured.safeSignals, ...delivery.safeSignals],
          ...(delivery.safeMessage ? { safeMessage: delivery.safeMessage } : {}),
        }
      : {
          ok: false,
          reason: delivery.reason,
          safeSignals: delivery.safeSignals,
        };
  } finally {
    safetyNet.remove();
  }
}
