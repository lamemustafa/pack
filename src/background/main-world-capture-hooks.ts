import { isPossibleArtifactContentType, isReadableBlob } from "./main-world-capture-utils";

export type CaptureUrl = (value: string | URL, filename?: string | null) => void;
export type CaptureText = (text: string) => void;
export type ReadBlob = (blob: Blob, filename?: string | null) => void;
export type AddSafeSignal = (signal: string) => void;

export type PdfMakeApi = {
  createPdf?: unknown;
};

export function installCapturingWindowOpen({
  addSafeSignal,
  captureEmbeddedUrls,
  captureUrl,
  markSuppressedWindowOpen,
  signalPrefix,
}: {
  addSafeSignal: AddSafeSignal;
  captureEmbeddedUrls: CaptureText;
  captureUrl: CaptureUrl;
  markSuppressedWindowOpen: () => void;
  signalPrefix: string;
}): void {
  window.open = function open(url?: string | URL) {
    addSafeSignal(`${signalPrefix}-window-open-observed`);
    markSuppressedWindowOpen();
    if (url) captureUrl(url);
    return createFakeCaptureWindow(captureUrl, captureEmbeddedUrls);
  };
}

export function installAnchorDownloadSuppression({
  captureAnchorDownload,
  captureBlobUrl,
  capturedBlobUrls,
  originalClick,
  originalDispatchEvent,
}: {
  captureAnchorDownload: (anchor: HTMLAnchorElement) => boolean;
  captureBlobUrl: (blobUrl: string, filename?: string | null) => void;
  capturedBlobUrls: Set<string>;
  originalClick: HTMLAnchorElement["click"];
  originalDispatchEvent: HTMLAnchorElement["dispatchEvent"];
}): void {
  const shouldSuppressAnchor = (anchor: HTMLAnchorElement) => {
    if (capturedBlobUrls.has(anchor.href)) {
      captureBlobUrl(anchor.href, anchor.getAttribute("download"));
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
}

export function installPdfMakeCapture(
  pdfMake: PdfMakeApi | undefined,
  originalPdfMakeCreatePdf: unknown,
  readBlob: ReadBlob,
): void {
  if (!pdfMake || typeof originalPdfMakeCreatePdf !== "function") return;

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

export function installFetchArtifactDiagnostics({
  addSafeSignal,
  originalFetch,
  signalPrefix,
}: {
  addSafeSignal: AddSafeSignal;
  originalFetch: typeof fetch;
  signalPrefix: string;
}): void {
  window.fetch = function fetch(input: RequestInfo | URL, init?: RequestInit) {
    return originalFetch.call(window, input, init).then((response) => {
      const contentType = response.headers.get("content-type");
      if (contentType && isPossibleArtifactContentType(contentType)) {
        addSafeSignal(`${signalPrefix}-fetch-artifact-response-observed`);
      }
      return response;
    });
  };
}

export function installXhrArtifactDiagnostics({
  addSafeSignal,
  isSettled,
  originalXhrOpen,
  originalXhrSend,
  signalPrefix,
}: {
  addSafeSignal: AddSafeSignal;
  isSettled: () => boolean;
  originalXhrOpen: XMLHttpRequest["open"];
  originalXhrSend: XMLHttpRequest["send"];
  signalPrefix: string;
}): void {
  const patchedXhrOpen: XMLHttpRequest["open"] = function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    user?: string | null,
    pass?: string | null,
  ) {
    this.addEventListener("load", () => {
      if (isSettled()) return;
      const contentType = this.getResponseHeader("content-type");
      if (contentType && !isPossibleArtifactContentType(contentType)) return;
      addSafeSignal(`${signalPrefix}-xhr-artifact-response-observed`);
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
}

export function installObjectUrlCapture({
  addSafeSignal,
  capturedBlobUrls,
  capturedBlobsByUrl,
  maxBytes,
  originalCreateObjectUrl,
  signalPrefix,
  urlApi,
  webkitUrlApi,
}: {
  addSafeSignal: AddSafeSignal;
  capturedBlobUrls: Set<string>;
  capturedBlobsByUrl: Map<string, Blob>;
  maxBytes: number;
  originalCreateObjectUrl: typeof URL.createObjectURL;
  signalPrefix: string;
  urlApi: typeof URL;
  webkitUrlApi?: typeof URL;
}): void {
  const captureCreateObjectUrl = function createObjectURL(value: Blob | MediaSource) {
    const blobUrl = originalCreateObjectUrl.call(urlApi, value);
    if (isReadableBlob(value) && value.size > 0 && value.size <= maxBytes) {
      addSafeSignal(`${signalPrefix}-create-object-url-observed`);
      capturedBlobUrls.add(blobUrl);
      capturedBlobsByUrl.set(blobUrl, value);
    } else if (isReadableBlob(value)) {
      addSafeSignal(
        value.size > maxBytes
          ? `${signalPrefix}-create-object-url-oversized-rejected`
          : `${signalPrefix}-create-object-url-zero-byte-rejected`,
      );
    }
    return blobUrl;
  };
  urlApi.createObjectURL = captureCreateObjectUrl;
  if (webkitUrlApi) {
    webkitUrlApi.createObjectURL = captureCreateObjectUrl;
  }
}

function createFakeCaptureWindow(captureUrl: CaptureUrl, captureEmbeddedUrls: CaptureText): Window {
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
    set: captureUrl,
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
    set: captureUrl,
  });
  return fakeWindow;
}
