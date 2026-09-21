import { browser } from "wxt/browser";
import { validateArtifactBytes } from "../connectors/gst/artifact-validation";
import type { FiledReturnsDownloadDiagnostic } from "../connectors/gst/filed-returns-contracts";
import {
  capturePortalPdfBlob,
  MAX_PORTAL_BLOB_BYTES,
  type PortalBlobShimResult,
} from "../connectors/gst/portal-blob-shim";
import { downloadAcquiredArtifact, installPortalBlobDownloadSafetyNet } from "./artifact-download";

/**
 * Live, 38 GSTR-3B captures took 0.2-1.5 s and 8 produced nothing in 20 s (#386). The first wait is
 * short; one re-click then gets the rest, so the total never exceeds the old 20 s limit.
 */
export const GSTR3B_FIRST_CAPTURE_WAIT_MS = 5_000;
export const GSTR3B_RECLICK_CAPTURE_WAIT_MS = 15_000;

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
    const capture = async (timeoutMs: number): Promise<PortalBlobShimResult | undefined> => {
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
            timeoutMs,
          },
        ],
        func: capturePortalPdfBlob,
        target: { tabId: input.tabId },
        world: "MAIN",
      });
      return injection?.result as PortalBlobShimResult | undefined;
    };
    let captured: PortalBlobShimResult | undefined;
    let reclicked = false;
    try {
      captured = await capture(GSTR3B_FIRST_CAPTURE_WAIT_MS);
      // The portal either answers a GSTR-3B click within about 1.5 s or not at all (#386). One more
      // click is safe only when nothing reached the browser: the capture re-checks the page's target
      // before clicking, the PDF is generated in the page with no server-side effect, and any
      // download the portal did start keeps today's review path instead.
      if (
        captured &&
        !captured.ok &&
        captured.reason === "generation-timeout" &&
        !safetyNet.sawDownload()
      ) {
        reclicked = true;
        captured = await capture(GSTR3B_RECLICK_CAPTURE_WAIT_MS);
      }
    } catch {
      return { ok: false, reason: "main-world-execution-failed", safeSignals: [] };
    }
    if (captured?.ok && reclicked) {
      captured = {
        ...captured,
        safeSignals: [...captured.safeSignals, "filed-gstr3b-capture-reclicked"],
      };
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
          ...(delivery.safeMessage ? { safeMessage: delivery.safeMessage } : {}),
          safeSignals: delivery.safeSignals,
        };
  } finally {
    safetyNet.remove();
  }
}
