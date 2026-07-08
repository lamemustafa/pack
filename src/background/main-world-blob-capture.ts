import type {
  FiledReturnsCapturedDownloadRequest,
  FiledReturnsMainWorldCaptureRequest,
} from "../core/contracts";
import {
  installAnchorDownloadSuppression,
  installCapturingWindowOpen,
  installFetchArtifactDiagnostics,
  installObjectUrlCapture,
  installPdfMakeCapture,
  installXhrArtifactDiagnostics,
  type PdfMakeApi,
} from "./main-world-capture-hooks";
import type {
  MainWorldCaptureOutcome,
  MainWorldChunkedCaptureRequest,
} from "./main-world-capture-contracts";
import {
  CAPTURE_SUPPRESSION_SETTLE_MS,
  DEFAULT_CAPTURE_TRANSFER_CHUNK_SIZE,
  MAIN_WORLD_CAPTURE_MESSAGE_SOURCE,
  capturedPortalSafeSignals,
  escapeCaptureCss,
  forEachEmbeddedCaptureUrl,
  isReadableBlob,
  splitCaptureDataUrlIntoChunks,
} from "./main-world-capture-utils";

export async function capturePortalBlobDownload(
  config: FiledReturnsMainWorldCaptureRequest,
): Promise<FiledReturnsCapturedDownloadRequest | null> {
  const outcome = await capturePortalBlobDownloadWithDiagnostics(config);
  return outcome.capturedDownloadRequest;
}

export async function capturePortalBlobDownloadWithDiagnostics(
  config: FiledReturnsMainWorldCaptureRequest,
): Promise<MainWorldCaptureOutcome> {
  return new Promise((resolve) => {
    const safeFailureSignals = new Set<string>([`${config.signalPrefix}-main-world-capture-armed`]);
    const addSafeSignal = (signal: string) => safeFailureSignals.add(signal);
    const urlApi = window.URL ?? URL;
    const webkitUrlApi = (window as Window & { webkitURL?: typeof URL }).webkitURL;
    const originalCreateObjectUrl = urlApi.createObjectURL;
    const originalWebkitCreateObjectUrl = webkitUrlApi?.createObjectURL;
    const originalFetch = window.fetch ?? globalThis.fetch;
    const pdfMake = (window as Window & { pdfMake?: PdfMakeApi }).pdfMake;
    const originalPdfMakeCreatePdf = pdfMake?.createPdf;
    const originalSaveAs = (window as Window & { saveAs?: unknown }).saveAs;
    const originalWindowOpen = window.open;
    const originalClick = HTMLAnchorElement.prototype.click;
    const originalDispatchEvent = HTMLAnchorElement.prototype.dispatchEvent;
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;
    const capturedBlobUrls = new Set<string>();
    const capturedBlobsByUrl = new Map<string, Blob>();
    let suppressedWindowOpen = false;
    let restored = false;
    let settled = false;

    const restore = () => {
      if (restored) return;
      restored = true;
      urlApi.createObjectURL = originalCreateObjectUrl;
      if (webkitUrlApi && originalWebkitCreateObjectUrl) {
        webkitUrlApi.createObjectURL = originalWebkitCreateObjectUrl;
      }
      window.fetch = originalFetch;
      if (pdfMake && originalPdfMakeCreatePdf) {
        pdfMake.createPdf = originalPdfMakeCreatePdf;
      }
      (window as Window & { saveAs?: unknown }).saveAs = originalSaveAs;
      window.open = originalWindowOpen;
      HTMLAnchorElement.prototype.click = originalClick;
      HTMLAnchorElement.prototype.dispatchEvent = originalDispatchEvent;
      XMLHttpRequest.prototype.open = originalXhrOpen;
      XMLHttpRequest.prototype.send = originalXhrSend;
      document
        .querySelector<HTMLElement>(
          `[${config.controlAttribute}="${escapeCaptureCss(config.controlId)}"]`,
        )
        ?.removeAttribute(config.controlAttribute);
    };

    const settle = (request: FiledReturnsCapturedDownloadRequest | null) => {
      if (settled) return;
      settled = true;
      const outcome: MainWorldCaptureOutcome = {
        capturedDownloadRequest: request,
        safeFailureSignals: request ? [] : Array.from(safeFailureSignals),
      };
      if (!request) {
        restore();
        resolve(outcome);
        return;
      }
      window.setTimeout(() => {
        restore();
        resolve(outcome);
      }, CAPTURE_SUPPRESSION_SETTLE_MS);
    };

    const settleChunked = (capturedUrl: string, safeSignals: string[]) => {
      if (settled || !config.transferId) return false;
      const chunks = splitCaptureDataUrlIntoChunks(
        capturedUrl,
        config.transferChunkSize ?? DEFAULT_CAPTURE_TRANSFER_CHUNK_SIZE,
      );
      if (!chunks) {
        addSafeSignal(`${config.signalPrefix}-chunk-count-rejected`);
        return false;
      }
      chunks.forEach((chunk, index) => {
        window.postMessage(
          {
            actionId: config.actionId,
            chunk,
            index,
            source: MAIN_WORLD_CAPTURE_MESSAGE_SOURCE,
            totalChunks: chunks.length,
            transferId: config.transferId,
          },
          window.location.origin,
        );
      });
      settled = true;
      const chunkedCaptureRequest: MainWorldChunkedCaptureRequest = {
        actionId: config.actionId,
        chunkCount: chunks.length,
        safeSignals: [...safeSignals, `${config.signalPrefix}-main-world-chunked-capture`],
        transferId: config.transferId,
      };
      const outcome: MainWorldCaptureOutcome = {
        capturedDownloadRequest: null,
        chunkedCaptureRequest,
        safeFailureSignals: [],
      };
      window.setTimeout(() => {
        restore();
        resolve(outcome);
      }, CAPTURE_SUPPRESSION_SETTLE_MS);
      return true;
    };

    const readBlob = (blob: Blob, filename?: string | null) => {
      if (settled) return;
      if (!blob.size) {
        addSafeSignal(`${config.signalPrefix}-blob-zero-byte-rejected`);
        return;
      }
      if (blob.size > config.maxBytes) {
        addSafeSignal(`${config.signalPrefix}-blob-oversized-rejected`);
        return;
      }
      addSafeSignal(`${config.signalPrefix}-blob-bytes-accepted`);
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (typeof reader.result !== "string") {
          addSafeSignal(`${config.signalPrefix}-file-reader-result-rejected`);
          settle(null);
          return;
        }
        const safeSignals = capturedPortalSafeSignals({
          filename,
          signalPrefix: config.signalPrefix,
          source: "blob",
          suppressedWindowOpen,
        });
        if (settleChunked(reader.result, safeSignals)) return;
        settle({
          actionId: config.actionId,
          dataUrl: reader.result,
          safeSignals,
        });
      });
      reader.addEventListener("error", () => {
        addSafeSignal(`${config.signalPrefix}-file-reader-error`);
        settle(null);
      });
      reader.readAsDataURL(blob);
    };

    const captureDataUrl = (dataUrl: string, filename?: string | null) => {
      if (settled) return;
      addSafeSignal(`${config.signalPrefix}-data-url-observed`);
      if (!dataUrl.startsWith("data:") || dataUrl.length > config.maxBytes * 2) {
        addSafeSignal(`${config.signalPrefix}-data-url-rejected`);
        return;
      }
      const safeSignals = capturedPortalSafeSignals({
        filename,
        signalPrefix: config.signalPrefix,
        source: "data-url",
        suppressedWindowOpen,
      });
      if (settleChunked(dataUrl, safeSignals)) return;
      settle({
        actionId: config.actionId,
        dataUrl,
        safeSignals,
      });
    };

    const captureBlobUrl = (blobUrl: string, filename?: string | null) => {
      if (settled) return;
      addSafeSignal(`${config.signalPrefix}-blob-url-observed`);
      const capturedBlob = capturedBlobsByUrl.get(blobUrl);
      if (capturedBlob) {
        readBlob(capturedBlob, filename);
        return;
      }
      if (typeof originalFetch !== "function") {
        addSafeSignal(`${config.signalPrefix}-blob-url-fetch-unavailable`);
        return;
      }
      void originalFetch
        .call(window, blobUrl)
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (blob) readBlob(blob, filename);
          else addSafeSignal(`${config.signalPrefix}-blob-url-fetch-rejected`);
        })
        .catch(() => addSafeSignal(`${config.signalPrefix}-blob-url-fetch-failed`));
    };

    const captureUrl = (value: string | URL, filename?: string | null) => {
      const nextUrl = String(value);
      if (nextUrl.startsWith("data:")) captureDataUrl(nextUrl, filename);
      if (nextUrl.startsWith("blob:")) captureBlobUrl(nextUrl, filename);
    };

    const captureEmbeddedUrls = (text: string) => {
      forEachEmbeddedCaptureUrl(text, captureUrl);
    };

    const captureAnchorDownload = (anchor: HTMLAnchorElement) => {
      if (!anchor.hasAttribute("download")) return false;
      if (anchor.href.startsWith("data:")) {
        captureDataUrl(anchor.href, anchor.getAttribute("download"));
        return true;
      }
      if (anchor.href.startsWith("blob:")) {
        if (!capturedBlobUrls.has(anchor.href)) {
          captureBlobUrl(anchor.href, anchor.getAttribute("download"));
        }
        return true;
      }
      return false;
    };

    installCapturingWindowOpen({
      addSafeSignal,
      captureEmbeddedUrls,
      captureUrl,
      markSuppressedWindowOpen: () => {
        suppressedWindowOpen = true;
      },
      signalPrefix: config.signalPrefix,
    });

    installPdfMakeCapture(pdfMake, originalPdfMakeCreatePdf, readBlob);

    (window as Window & { saveAs?: unknown }).saveAs = function saveAs(
      value: unknown,
      filename?: string | null,
    ) {
      if (isReadableBlob(value)) {
        readBlob(value, filename);
        return undefined;
      }
      if (typeof value === "string") {
        captureUrl(value, filename);
        return undefined;
      }
      return undefined;
    };

    installFetchArtifactDiagnostics({
      addSafeSignal,
      originalFetch,
      signalPrefix: config.signalPrefix,
    });
    installXhrArtifactDiagnostics({
      addSafeSignal,
      isSettled: () => settled,
      originalXhrOpen,
      originalXhrSend,
      signalPrefix: config.signalPrefix,
    });
    installObjectUrlCapture({
      addSafeSignal,
      capturedBlobUrls,
      capturedBlobsByUrl,
      maxBytes: config.maxBytes,
      originalCreateObjectUrl,
      signalPrefix: config.signalPrefix,
      urlApi,
      ...(webkitUrlApi ? { webkitUrlApi } : {}),
    });

    installAnchorDownloadSuppression({
      captureAnchorDownload,
      captureBlobUrl,
      capturedBlobUrls,
      originalClick,
      originalDispatchEvent,
    });

    const control = document.querySelector<HTMLElement>(
      `[${config.controlAttribute}="${escapeCaptureCss(config.controlId)}"]`,
    );
    if (!control) {
      addSafeSignal(`${config.signalPrefix}-capture-control-not-found`);
      settle(null);
      return;
    }
    control.click();
    window.setTimeout(() => {
      addSafeSignal(`${config.signalPrefix}-main-world-capture-timeout`);
      settle(null);
    }, config.timeoutMs ?? 60_000);
  });
}
