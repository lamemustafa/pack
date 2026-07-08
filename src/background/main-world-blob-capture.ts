import type {
  FiledReturnsCapturedDownloadRequest,
  FiledReturnsMainWorldCaptureRequest,
} from "../core/contracts";
import type { MainWorldCaptureOutcome, MainWorldChunkedCaptureRequest } from "./main-world-capture-contracts";

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
    const captureSuppressionSettleMs = 1_000;
    const defaultTransferChunkSize = 512 * 1024;
    const mainWorldCaptureMessageSource = "pack-main-world-capture-v1";
    const safeFailureSignals = new Set<string>([`${config.signalPrefix}-main-world-capture-armed`]);
    const addSafeSignal = (signal: string) => safeFailureSignals.add(signal);
    const escapeCss = (value: string) => {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
      }
      return value.replace(/["\\]/g, "\\$&");
    };
    const urlApi = window.URL ?? URL;
    const webkitUrlApi = (window as Window & { webkitURL?: typeof URL }).webkitURL;
    const originalCreateObjectUrl = urlApi.createObjectURL;
    const originalWebkitCreateObjectUrl = webkitUrlApi?.createObjectURL;
    const originalFetch = window.fetch ?? globalThis.fetch;
    const pdfMake = (window as Window & { pdfMake?: { createPdf?: unknown } }).pdfMake;
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
        .querySelector<HTMLElement>(`[${config.controlAttribute}="${escapeCss(config.controlId)}"]`)
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
      }, captureSuppressionSettleMs);
    };

    const settleChunked = (capturedUrl: string, safeSignals: string[]) => {
      if (settled || !config.transferId) return false;
      const chunkSize = config.transferChunkSize ?? defaultTransferChunkSize;
      const chunks: string[] = [];
      for (let offset = 0; offset < capturedUrl.length; offset += chunkSize) {
        chunks.push(capturedUrl.slice(offset, offset + chunkSize));
      }
      if (chunks.length === 0 || chunks.length > 200) {
        addSafeSignal(`${config.signalPrefix}-chunk-count-rejected`);
        return false;
      }
      chunks.forEach((chunk, index) => {
        window.postMessage(
          {
            actionId: config.actionId,
            chunk,
            index,
            source: mainWorldCaptureMessageSource,
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
      }, captureSuppressionSettleMs);
      return true;
    };

    const isReadableBlob = (value: unknown): value is Blob => {
      if (!value || typeof value !== "object") return false;
      const candidate = value as Partial<Blob>;
      return (
        typeof candidate.size === "number" &&
        typeof candidate.type === "string" &&
        typeof candidate.arrayBuffer === "function"
      );
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
        const safeSignals = [
          `${config.signalPrefix}-portal-blob-captured`,
          `${config.signalPrefix}-native-blob-click-suppressed`,
          `${config.signalPrefix}-main-world-capture`,
          ...(suppressedWindowOpen
            ? [`${config.signalPrefix}-native-window-open-suppressed`]
            : []),
          ...(filename ? [`${config.signalPrefix}-portal-filename-observed`] : []),
        ];
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
      const safeSignals = [
        `${config.signalPrefix}-portal-data-url-captured`,
        `${config.signalPrefix}-native-data-click-suppressed`,
        `${config.signalPrefix}-main-world-capture`,
        ...(suppressedWindowOpen
          ? [`${config.signalPrefix}-native-window-open-suppressed`]
          : []),
        ...(filename ? [`${config.signalPrefix}-portal-filename-observed`] : []),
      ];
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

    const isPossibleArtifactContentType = (contentType: string) => {
      const normalised = contentType.toLowerCase();
      return [
        "application/pdf",
        "application/octet-stream",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument",
      ].some((expected) => normalised.includes(expected));
    };

    const captureEmbeddedUrls = (text: string) => {
      for (const [url] of text.matchAll(/\b(?:blob|data):[^"'<>\\\s)]+/g)) {
        captureUrl(url);
      }
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

    window.open = function open(url?: string | URL) {
      addSafeSignal(`${config.signalPrefix}-window-open-observed`);
      suppressedWindowOpen = true;
      if (url) captureUrl(url);
      const captureWindowLocation = (value: string | URL) => captureUrl(value);
      const fakeDocument = {
        close: () => undefined,
        open: () => fakeDocument,
        write: (...chunks: string[]) => {
          chunks.forEach((chunk) => captureEmbeddedUrls(String(chunk)));
        },
        writeln: (...chunks: string[]) => {
          chunks.forEach((chunk) => captureEmbeddedUrls(String(chunk)));
        },
      } as unknown as Document;
      const fakeLocation = {} as Location;
      Object.defineProperty(fakeLocation, "href", {
        configurable: true,
        get() {
          return "";
        },
        set: captureWindowLocation,
      });
      const fakeWindow = {
        close: () => undefined,
        document: fakeDocument,
        focus: () => undefined,
      } as Window & { location: Location };
      Object.defineProperty(fakeWindow, "location", {
        configurable: true,
        get() {
          return fakeLocation;
        },
        set: captureWindowLocation,
      });
      return fakeWindow;
    };

    const shouldSuppressAnchor = (anchor: HTMLAnchorElement) => {
      if (capturedBlobUrls.has(anchor.href)) {
        captureBlobUrl(anchor.href, anchor.getAttribute("download"));
        return true;
      }
      return captureAnchorDownload(anchor);
    };

    if (pdfMake && typeof originalPdfMakeCreatePdf === "function") {
      pdfMake.createPdf = function createPdf(...args: unknown[]) {
        const pdf = originalPdfMakeCreatePdf.apply(this, args) as
          | {
              download?: (filename?: string | null) => unknown;
              getBlob?: (callback: (blob: Blob) => void) => unknown;
              open?: (...openArgs: unknown[]) => unknown;
              print?: (...printArgs: unknown[]) => unknown;
            }
          | null
          | undefined;
        if (!pdf || typeof pdf !== "object") return pdf;

        const readPdfBlob = (filename?: string | null) => {
          if (typeof pdf.getBlob !== "function") return;
          try {
            pdf.getBlob((blob) => readBlob(blob, filename));
          } catch {
            // Ignore portal/pdfMake generation failures; the capture timeout will settle.
          }
        };
        const originalDownload = pdf.download;
        if (typeof originalDownload === "function") {
          pdf.download = function download(filename?: string | null) {
            readPdfBlob(filename);
            return undefined;
          };
        }

        const originalOpen = pdf.open;
        if (typeof originalOpen === "function") {
          pdf.open = function open() {
            readPdfBlob();
            return undefined;
          };
        }

        const originalPrint = pdf.print;
        if (typeof originalPrint === "function") {
          pdf.print = function print() {
            readPdfBlob();
            return undefined;
          };
        }

        return pdf;
      };
    }

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

    window.fetch = function fetch(input: RequestInfo | URL, init?: RequestInit) {
      return originalFetch.call(window, input, init).then((response) => {
        const contentType = response.headers.get("content-type");
        if (contentType && isPossibleArtifactContentType(contentType)) {
          addSafeSignal(`${config.signalPrefix}-fetch-artifact-response-observed`);
        }
        return response;
      });
    };

    const patchedXhrOpen: XMLHttpRequest["open"] = function open(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async?: boolean,
      user?: string | null,
      pass?: string | null,
    ) {
      this.addEventListener("load", () => {
        if (settled) return;
        const contentType = this.getResponseHeader("content-type");
        if (contentType && !isPossibleArtifactContentType(contentType)) return;
        addSafeSignal(`${config.signalPrefix}-xhr-artifact-response-observed`);
      });
      if (arguments.length <= 2) {
        const openWithoutAsync = originalXhrOpen as (
          this: XMLHttpRequest,
          method: string,
          url: string | URL,
        ) => void;
        return openWithoutAsync.call(this, method, url);
      }
      const openWithAsync = originalXhrOpen as (
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        async: boolean,
        user?: string | null,
        pass?: string | null,
      ) => void;
      return openWithAsync.call(this, method, url, async ?? true, user, pass);
    };
    XMLHttpRequest.prototype.open = patchedXhrOpen;

    XMLHttpRequest.prototype.send = function send(body?: Document | XMLHttpRequestBodyInit | null) {
      return originalXhrSend.call(this, body);
    };

    const captureCreateObjectUrl = function createObjectURL(value: Blob | MediaSource) {
      const blobUrl = originalCreateObjectUrl.call(urlApi, value);
      if (isReadableBlob(value) && value.size > 0 && value.size <= config.maxBytes) {
        addSafeSignal(`${config.signalPrefix}-create-object-url-observed`);
        capturedBlobUrls.add(blobUrl);
        capturedBlobsByUrl.set(blobUrl, value);
      } else if (isReadableBlob(value)) {
        addSafeSignal(
          value.size > config.maxBytes
            ? `${config.signalPrefix}-create-object-url-oversized-rejected`
            : `${config.signalPrefix}-create-object-url-zero-byte-rejected`,
        );
      }
      return blobUrl;
    };
    urlApi.createObjectURL = captureCreateObjectUrl;
    if (webkitUrlApi) {
      webkitUrlApi.createObjectURL = captureCreateObjectUrl;
    }

    HTMLAnchorElement.prototype.click = function click() {
      if (shouldSuppressAnchor(this)) return undefined;
      return originalClick.call(this);
    };

    HTMLAnchorElement.prototype.dispatchEvent = function dispatchEvent(event: Event) {
      if (event.type === "click" && shouldSuppressAnchor(this)) return true;
      return originalDispatchEvent.call(this, event);
    };

    const control = document.querySelector<HTMLElement>(
      `[${config.controlAttribute}="${escapeCss(config.controlId)}"]`,
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
