import type {
  FiledReturnsCapturedDownloadRequest,
  FiledReturnsMainWorldCaptureRequest,
} from "../core/contracts";
import type { MainWorldCaptureOutcome } from "./main-world-capture-contracts";

type PdfMakeApi = {
  createPdf?: unknown;
};

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
    const cssEscape = (value: string) => {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
      }
      return value.replace(/["\\]/g, "\\$&");
    };
    const isBlobLike = (value: unknown): value is Blob => {
      if (!value || typeof value !== "object") return false;
      const candidate = value as Partial<Blob>;
      return (
        typeof candidate.size === "number" &&
        typeof candidate.type === "string" &&
        typeof candidate.arrayBuffer === "function"
      );
    };
    const isArtifactContentType = (contentType: string) => {
      const normalised = contentType.toLowerCase();
      return [
        "application/pdf",
        "application/octet-stream",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument",
      ].some((expected) => normalised.includes(expected));
    };
    const captureSignals = (source: "blob" | "data-url", filename: string | null | undefined) => [
      ...(source === "blob"
        ? [
            `${config.signalPrefix}-portal-blob-captured`,
            `${config.signalPrefix}-native-blob-click-suppressed`,
          ]
        : [
            `${config.signalPrefix}-portal-data-url-captured`,
            `${config.signalPrefix}-native-data-click-suppressed`,
          ]),
      `${config.signalPrefix}-main-world-capture`,
      ...(suppressedWindowOpen ? [`${config.signalPrefix}-native-window-open-suppressed`] : []),
      ...(filename ? [`${config.signalPrefix}-portal-filename-observed`] : []),
    ];
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
    const actionBoundBlobs = new WeakSet<Blob>();
    const actionBoundXhrs = new WeakSet<XMLHttpRequest>();
    let controlClickActive = false;
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
        .querySelector<HTMLElement>(`[${config.controlAttribute}="${cssEscape(config.controlId)}"]`)
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
      }, 1_000);
    };

    const readBlob = (blob: Blob, filename?: string | null, actionBound = false) => {
      if (settled) return;
      if (!actionBound && !actionBoundBlobs.has(blob)) {
        addSafeSignal(`${config.signalPrefix}-unbound-blob-ignored`);
        return;
      }
      actionBoundBlobs.add(blob);
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
        const safeSignals = captureSignals("blob", filename);
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

    const captureDataUrl = (dataUrl: string, filename?: string | null, actionBound = false) => {
      if (settled) return;
      if (!actionBound) {
        addSafeSignal(`${config.signalPrefix}-unbound-data-url-ignored`);
        return;
      }
      addSafeSignal(`${config.signalPrefix}-data-url-observed`);
      if (!dataUrl.startsWith("data:") || dataUrl.length > config.maxBytes * 2) {
        addSafeSignal(`${config.signalPrefix}-data-url-rejected`);
        return;
      }
      const safeSignals = captureSignals("data-url", filename);
      settle({
        actionId: config.actionId,
        dataUrl,
        safeSignals,
      });
    };

    const captureBlobUrl = (blobUrl: string, filename?: string | null, actionBound = false) => {
      if (settled) return;
      if (!actionBound) {
        addSafeSignal(`${config.signalPrefix}-unbound-blob-url-ignored`);
        return;
      }
      addSafeSignal(`${config.signalPrefix}-blob-url-observed`);
      const capturedBlob = capturedBlobsByUrl.get(blobUrl);
      if (capturedBlob) {
        readBlob(capturedBlob, filename, true);
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
          if (blob) readBlob(blob, filename, true);
          else addSafeSignal(`${config.signalPrefix}-blob-url-fetch-rejected`);
        })
        .catch(() => addSafeSignal(`${config.signalPrefix}-blob-url-fetch-failed`));
    };

    const captureUrl = (value: string | URL, filename?: string | null, actionBound = false) => {
      const nextUrl = String(value);
      if (nextUrl.startsWith("data:")) captureDataUrl(nextUrl, filename, actionBound);
      if (nextUrl.startsWith("blob:")) captureBlobUrl(nextUrl, filename, actionBound);
    };

    const captureEmbeddedUrls = (text: string, actionBound = false) => {
      for (const [url] of text.matchAll(/\b(?:blob|data):[^"'<>\\\s)]+/g)) {
        captureUrl(url, undefined, actionBound);
      }
    };

    const captureAnchorDownload = (anchor: HTMLAnchorElement) => {
      if (!anchor.hasAttribute("download")) return false;
      if (anchor.href.startsWith("data:")) {
        if (!controlClickActive) return false;
        captureDataUrl(anchor.href, anchor.getAttribute("download"), true);
        return true;
      }
      if (anchor.href.startsWith("blob:")) {
        const actionBound = controlClickActive || capturedBlobUrls.has(anchor.href);
        if (!actionBound) return false;
        captureBlobUrl(anchor.href, anchor.getAttribute("download"), true);
        return true;
      }
      return false;
    };

    window.open = function open(url?: string | URL) {
      if (!controlClickActive) {
        return originalWindowOpen.call(window, url);
      }
      addSafeSignal(`${config.signalPrefix}-window-open-observed`);
      suppressedWindowOpen = true;
      if (url) captureUrl(url, undefined, true);
      return {
        close() {
          return undefined;
        },
        document: {
          close() {
            return undefined;
          },
          open() {
            return undefined;
          },
          write(value: string) {
            captureEmbeddedUrls(value, true);
          },
        },
        focus() {
          return undefined;
        },
        location: {
          assign(value: string | URL) {
            captureUrl(value, undefined, true);
          },
          replace(value: string | URL) {
            captureUrl(value, undefined, true);
          },
          set href(value: string) {
            captureUrl(value, undefined, true);
          },
        },
      } as unknown as WindowProxy;
    };

    if (pdfMake && typeof originalPdfMakeCreatePdf === "function") {
      pdfMake.createPdf = function createPdf(...args: unknown[]) {
        const actionBound = controlClickActive;
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
        if (!actionBound) return pdf;

        const readPdfBlob = (filename?: string | null) => {
          if (typeof pdf.getBlob !== "function") return;
          try {
            pdf.getBlob((blob) => readBlob(blob, filename, true));
          } catch {
            // Let the capture timeout settle portal/pdfMake generation failures.
          }
        };

        if (typeof pdf.download === "function") {
          pdf.download = function download(filename?: string | null) {
            readPdfBlob(filename);
            return undefined;
          };
        }
        if (typeof pdf.open === "function") {
          pdf.open = function open() {
            readPdfBlob();
            return undefined;
          };
        }
        if (typeof pdf.print === "function") {
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
      const actionBound = controlClickActive || (isBlobLike(value) && actionBoundBlobs.has(value));
      if (!actionBound) {
        return typeof originalSaveAs === "function"
          ? originalSaveAs.call(window, value, filename)
          : undefined;
      }
      if (isBlobLike(value)) {
        readBlob(value, filename, true);
        return undefined;
      }
      if (typeof value === "string") {
        captureUrl(value, filename, true);
        return undefined;
      }
      return undefined;
    };

    window.fetch = function fetch(input: RequestInfo | URL, init?: RequestInit) {
      const actionBound = controlClickActive;
      return originalFetch.call(window, input, init).then((response) => {
        const contentType = response.headers.get("content-type");
        if (actionBound && contentType && isArtifactContentType(contentType)) {
          addSafeSignal(`${config.signalPrefix}-fetch-artifact-response-observed`);
        }
        return response;
      });
    };

    XMLHttpRequest.prototype.open = function open(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async?: boolean,
      user?: string | null,
      pass?: string | null,
    ) {
      if (controlClickActive) actionBoundXhrs.add(this);
      if (actionBoundXhrs.has(this)) {
        this.addEventListener("load", () => {
          if (settled) return;
          const contentType = this.getResponseHeader("content-type");
          if (contentType && !isArtifactContentType(contentType)) return;
          addSafeSignal(`${config.signalPrefix}-xhr-artifact-response-observed`);
        });
      }
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
    XMLHttpRequest.prototype.send = function send(body?: Document | XMLHttpRequestBodyInit | null) {
      return originalXhrSend.call(this, body);
    };

    const captureCreateObjectUrl = function createObjectURL(value: Blob | MediaSource) {
      const blobUrl = originalCreateObjectUrl.call(urlApi, value);
      const actionBound = isBlobLike(value) && (controlClickActive || actionBoundBlobs.has(value));
      if (actionBound && value.size > 0 && value.size <= config.maxBytes) {
        addSafeSignal(`${config.signalPrefix}-create-object-url-observed`);
        actionBoundBlobs.add(value);
        capturedBlobUrls.add(blobUrl);
        capturedBlobsByUrl.set(blobUrl, value);
      } else if (actionBound) {
        addSafeSignal(
          value.size > config.maxBytes
            ? `${config.signalPrefix}-create-object-url-oversized`
            : `${config.signalPrefix}-create-object-url-zero-byte`,
        );
      } else if (isBlobLike(value)) {
        addSafeSignal(`${config.signalPrefix}-unbound-create-object-url-ignored`);
      }
      return blobUrl;
    };
    urlApi.createObjectURL = captureCreateObjectUrl;
    if (webkitUrlApi) webkitUrlApi.createObjectURL = captureCreateObjectUrl;

    const shouldSuppressAnchor = (anchor: HTMLAnchorElement) => {
      if (capturedBlobUrls.has(anchor.href)) {
        captureBlobUrl(anchor.href, anchor.getAttribute("download"), true);
        return true;
      }
      return captureAnchorDownload(anchor);
    };
    HTMLAnchorElement.prototype.click = function click() {
      if (shouldSuppressAnchor(this)) return undefined;
      return originalClick.call(this);
    };
    HTMLAnchorElement.prototype.dispatchEvent = function dispatchEvent(event: Event) {
      if (event.type === "click" && shouldSuppressAnchor(this)) return true;
      return originalDispatchEvent.call(this, event);
    };

    const control = document.querySelector<HTMLElement>(
      `[${config.controlAttribute}="${cssEscape(config.controlId)}"]`,
    );
    if (!control) {
      addSafeSignal(`${config.signalPrefix}-capture-control-not-found`);
      settle(null);
      return;
    }
    try {
      controlClickActive = true;
      control.click();
    } catch {
      addSafeSignal(`${config.signalPrefix}-capture-control-click-threw`);
      settle(null);
      return;
    } finally {
      controlClickActive = false;
    }
    window.setTimeout(() => {
      addSafeSignal(`${config.signalPrefix}-main-world-capture-timeout`);
      settle(null);
    }, config.timeoutMs ?? 60_000);
  });
}
