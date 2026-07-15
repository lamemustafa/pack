import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capturePortalBlobDownload,
  capturePortalBlobDownloadWithDiagnostics,
} from "../../src/background/main-world-blob-capture";
import type { FiledReturnsMainWorldCaptureRequest } from "../../src/core/contracts";

describe("capturePortalBlobDownload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the injected function independent of module-scope constants", () => {
    const source = capturePortalBlobDownloadWithDiagnostics.toString();

    expect(source).not.toContain("CAPTURE_SUPPRESSION_SETTLE_MS");
    expect(source).not.toContain("MAIN_WORLD_CAPTURE_CHUNK_SIZE");
    expect(source).not.toContain("PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE");
    expect(source).not.toContain("window.postMessage");
  });

  it("captures and suppresses portal data-url anchor downloads", async () => {
    const { documentRef } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let nativeClicks = 0;
    documentRef.defaultView!.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const anchor = documentRef.createElement("a");
      anchor.href = `data:application/pdf;base64,${btoa("%PDF-1.7 synthetic")}`;
      anchor.download = "may.pdf";
      anchor.click();
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured).toMatchObject({
      actionId: "action-1",
      safeSignals: expect.arrayContaining([
        "gstr2b-portal-data-url-captured",
        "gstr2b-native-data-click-suppressed",
        "gstr2b-main-world-capture",
        "gstr2b-portal-filename-observed",
      ]),
    });
    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeClicks).toBe(0);
  });

  it("captures and suppresses pre-existing portal blob anchor downloads", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let nativeClicks = 0;
    documentRef.defaultView!.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        blob: async () =>
          new view.Blob(["%PDF-1.7 synthetic"], {
            type: "application/pdf",
          }),
      })),
    );
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const anchor = documentRef.createElement("a");
      anchor.href = "blob:https://gstr2b.gst.gov.in/synthetic";
      anchor.download = "may.pdf";
      anchor.click();
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured).toMatchObject({
      actionId: "action-1",
      safeSignals: expect.arrayContaining([
        "gstr2b-portal-blob-captured",
        "gstr2b-native-blob-click-suppressed",
        "gstr2b-main-world-capture",
      ]),
    });
    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeClicks).toBe(0);
  });

  it("keeps suppression active for delayed portal blob clicks after bytes are captured", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let nativeClicks = 0;
    documentRef.defaultView!.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const blob = new view.Blob(["%PDF-1.7 synthetic"], {
        type: "application/pdf",
      });
      const url = view.URL.createObjectURL(blob);
      const anchor = documentRef.createElement("a");
      anchor.href = url;
      anchor.download = "may.pdf";
      view.setTimeout(() => anchor.click(), 0);
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured).toMatchObject({
      actionId: "action-1",
      safeSignals: expect.arrayContaining([
        "gstr2b-portal-blob-captured",
        "gstr2b-native-blob-click-suppressed",
      ]),
    });
    expect(nativeClicks).toBe(0);
  });

  it("captures and suppresses PDFMake-style child-window blob navigation", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let nativeOpens = 0;
    view.open = vi.fn(() => {
      nativeOpens += 1;
      return null;
    });
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const blob = new view.Blob(["%PDF-1.7 synthetic"], {
        type: "application/pdf",
      });
      const url = view.URL.createObjectURL(blob);
      const childWindow = view.open("", "_blank");
      if (childWindow) childWindow.location.href = url;
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured).toMatchObject({
      actionId: "action-1",
      safeSignals: expect.arrayContaining([
        "gstr2b-portal-blob-captured",
        "gstr2b-native-blob-click-suppressed",
        "gstr2b-main-world-capture",
        "gstr2b-native-window-open-suppressed",
      ]),
    });
    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeOpens).toBe(0);
  });

  it("captures and suppresses PDFMake-style window.open data-url navigation", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let nativeOpens = 0;
    view.open = vi.fn(() => {
      nativeOpens += 1;
      return null;
    });
    documentRef.querySelector("button")?.addEventListener("click", () => {
      view.open(`data:application/pdf;base64,${btoa("%PDF-1.7 synthetic")}`, "_blank");
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured).toMatchObject({
      actionId: "action-1",
      safeSignals: expect.arrayContaining([
        "gstr2b-portal-data-url-captured",
        "gstr2b-native-data-click-suppressed",
        "gstr2b-main-world-capture",
        "gstr2b-native-window-open-suppressed",
      ]),
    });
    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeOpens).toBe(0);
  });

  it("captures and suppresses PDFMake-style child-window iframe writes", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let nativeOpens = 0;
    view.open = vi.fn(() => {
      nativeOpens += 1;
      return null;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        blob: async () =>
          new view.Blob(["%PDF-1.7 synthetic"], {
            type: "application/pdf",
          }),
      })),
    );
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const childWindow = view.open("", "_blank");
      childWindow?.document.write(
        '<iframe src="blob:https://gstr2b.gst.gov.in/generated"></iframe>',
      );
      childWindow?.document.close();
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured).toMatchObject({
      actionId: "action-1",
      safeSignals: expect.arrayContaining([
        "gstr2b-portal-blob-captured",
        "gstr2b-native-blob-click-suppressed",
        "gstr2b-main-world-capture",
        "gstr2b-native-window-open-suppressed",
      ]),
    });
    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeOpens).toBe(0);
  });

  it("does not capture passive portal fetch responses before a download handoff", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    view.fetch = vi.fn(async () => ({
      clone: () => ({
        blob: async () =>
          new view.Blob(["%PDF-1.7 synthetic"], {
            type: "application/pdf",
          }),
      }),
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-type" ? "application/pdf" : null),
      },
    })) as unknown as typeof fetch;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      void view.fetch("/returns/auth/gstr1/generated");
    });

    const captured = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      timeoutMs: 5,
    });

    expect(captured.capturedDownloadRequest).toBeNull();
    expect(captured.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-fetch-artifact-response-observed",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
  });

  it("preserves action binding through an asynchronous fetch blob handoff", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let nativeClicks = 0;
    documentRef.defaultView!.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    const readResponseBlob = vi.fn(
      async () =>
        new view.Blob(["%PDF-1.7 action-bound fetch bytes"], {
          type: "application/pdf",
        }),
    );
    const response = {
      blob: readResponseBlob,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-type" ? "application/pdf" : null),
      },
    };
    view.fetch = vi.fn(async () => response) as unknown as typeof fetch;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      void view
        .fetch("/returns/auth/gstr1/generated")
        .then((response) => response.blob())
        .then((blob) => {
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(blob);
          anchor.download = "may.pdf";
          anchor.click();
        });
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured).toMatchObject({
      actionId: "action-1",
      safeSignals: expect.arrayContaining([
        "gstr2b-portal-blob-captured",
        "gstr2b-native-blob-click-suppressed",
        "gstr2b-main-world-capture",
      ]),
    });
    expect(nativeClicks).toBe(0);
    expect(response.blob).toBe(readResponseBlob);
  });

  it("does not capture passive portal XHR responses before a download handoff", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    installFakeXhr(
      view,
      () =>
        new view.Blob(["%PDF-1.7 synthetic"], {
          type: "application/pdf",
        }),
    );
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr1/generated");
      xhr.send();
    });

    const captured = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      timeoutMs: 5,
    });

    expect(captured.capturedDownloadRequest).toBeNull();
    expect(captured.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-xhr-artifact-response-observed",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
  });

  it("captures FileSaver-style saveAs blob downloads", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let nativeSaveAsCalls = 0;
    Object.defineProperty(view, "saveAs", {
      configurable: true,
      value: () => {
        nativeSaveAsCalls += 1;
      },
      writable: true,
    });
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const blob = new view.Blob(["%PDF-1.7 synthetic"], {
        type: "application/pdf",
      });
      (view as unknown as Window & { saveAs: (value: Blob, filename: string) => void }).saveAs(
        blob,
        "may.pdf",
      );
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured).toMatchObject({
      actionId: "action-1",
      safeSignals: expect.arrayContaining([
        "gstr2b-portal-blob-captured",
        "gstr2b-main-world-capture",
        "gstr2b-portal-filename-observed",
      ]),
    });
    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeSaveAsCalls).toBe(0);
  });

  it("captures pdfMake generated PDF downloads", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let nativeDownloadCalls = 0;
    Object.defineProperty(view, "pdfMake", {
      configurable: true,
      value: {
        createPdf: () => ({
          download: () => {
            nativeDownloadCalls += 1;
          },
          getBlob: (callback: (blob: Blob) => void) => {
            callback(
              new view.Blob(["%PDF-1.7 synthetic"], {
                type: "application/pdf",
              }),
            );
          },
        }),
      },
      writable: true,
    });
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const pdf = (
        view as unknown as {
          pdfMake: { createPdf: () => { download: (filename: string) => void } };
        }
      ).pdfMake.createPdf();
      pdf.download("may.pdf");
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured).toMatchObject({
      actionId: "action-1",
      safeSignals: expect.arrayContaining([
        "gstr2b-portal-blob-captured",
        "gstr2b-main-world-capture",
        "gstr2b-portal-filename-observed",
      ]),
    });
    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeDownloadCalls).toBe(0);
  });

  it("captures FileSaver-style downloads through a captured URL object", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const capturedUrlApi = view.URL;
    let nativeClicks = 0;
    documentRef.defaultView!.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const blob = new view.Blob(["%PDF-1.7 synthetic"], {
        type: "application/pdf",
      });
      const anchor = documentRef.createElement("a");
      anchor.href = capturedUrlApi.createObjectURL(blob);
      anchor.download = "may.pdf";
      anchor.click();
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured).toMatchObject({
      actionId: "action-1",
      safeSignals: expect.arrayContaining([
        "gstr2b-portal-blob-captured",
        "gstr2b-native-blob-click-suppressed",
        "gstr2b-main-world-capture",
      ]),
    });
    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeClicks).toBe(0);
  });

  it("captures FileSaver-style downloads through webkitURL", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    Object.defineProperty(view, "webkitURL", {
      configurable: true,
      value: view.URL,
      writable: true,
    });
    let nativeClicks = 0;
    documentRef.defaultView!.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const blob = new view.Blob(["%PDF-1.7 synthetic"], {
        type: "application/pdf",
      });
      const anchor = documentRef.createElement("a");
      anchor.href = (
        view as unknown as Window & { webkitURL: typeof URL }
      ).webkitURL.createObjectURL(blob);
      anchor.download = "may.pdf";
      anchor.click();
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured).toMatchObject({
      actionId: "action-1",
      safeSignals: expect.arrayContaining([
        "gstr2b-portal-blob-captured",
        "gstr2b-native-blob-click-suppressed",
        "gstr2b-main-world-capture",
      ]),
    });
    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeClicks).toBe(0);
  });

  it("returns captured bytes only through the extension injection result", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const pageMessages: unknown[] = [];
    view.addEventListener("message", (event) => {
      pageMessages.push(event.data);
    });
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const blob = new view.Blob(["%PDF-1.7 synthetic private capture"], {
        type: "application/pdf",
      });
      const anchor = documentRef.createElement("a");
      anchor.href = view.URL.createObjectURL(blob);
      anchor.download = "may.pdf";
      anchor.click();
    });

    const captured = await capturePortalBlobDownloadWithDiagnostics(captureConfig());

    expect(captured.capturedDownloadRequest).toMatchObject({
      actionId: "action-1",
      dataUrl: expect.stringContaining("data:application/pdf;base64,"),
    });
    expect(pageMessages).toEqual([]);
  });

  it("restores every main-world hook when the portal control click throws", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const originalFetch = vi.fn();
    Object.defineProperty(view, "fetch", {
      configurable: true,
      value: originalFetch,
      writable: true,
    });
    const originalCreateObjectUrl = view.URL.createObjectURL;
    const originalWindowOpen = view.open;
    const originalAnchorClick = view.HTMLAnchorElement.prototype.click;
    const originalAnchorDispatch = view.HTMLAnchorElement.prototype.dispatchEvent;
    const originalXhrOpen = view.XMLHttpRequest.prototype.open;
    const originalXhrSend = view.XMLHttpRequest.prototype.send;
    const control = documentRef.querySelector<HTMLButtonElement>("button")!;
    control.click = () => {
      throw new Error("synthetic portal click failure");
    };

    const outcome = await capturePortalBlobDownloadWithDiagnostics(captureConfig());

    expect(outcome).toMatchObject({
      capturedDownloadRequest: null,
      safeFailureSignals: expect.arrayContaining([
        "gstr2b-main-world-capture-armed",
        "gstr2b-capture-control-click-threw",
      ]),
    });
    expect(view.URL.createObjectURL).toBe(originalCreateObjectUrl);
    expect(view.fetch).toBe(originalFetch);
    expect(view.open).toBe(originalWindowOpen);
    expect(view.HTMLAnchorElement.prototype.click).toBe(originalAnchorClick);
    expect(view.HTMLAnchorElement.prototype.dispatchEvent).toBe(originalAnchorDispatch);
    expect(view.XMLHttpRequest.prototype.open).toBe(originalXhrOpen);
    expect(view.XMLHttpRequest.prototype.send).toBe(originalXhrSend);
    expect(control.hasAttribute("data-pack-gstr2b-capture-action")).toBe(false);
  });

  it("leaves a delayed blob download from a previous page action untouched", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let nativeClicks = 0;
    documentRef.defaultView!.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    view.setTimeout(() => {
      const anchor = documentRef.createElement("a");
      anchor.href = view.URL.createObjectURL(
        new view.Blob(["%PDF-1.7 unrelated delayed bytes"], {
          type: "application/pdf",
        }),
      );
      anchor.download = "previous.pdf";
      anchor.click();
    }, 0);

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      timeoutMs: 20,
    });

    expect(outcome).toMatchObject({
      capturedDownloadRequest: null,
      safeFailureSignals: expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    });
    expect(nativeClicks).toBe(1);
  });
});

function captureConfig(): FiledReturnsMainWorldCaptureRequest {
  return {
    actionId: "action-1",
    controlAttribute: "data-pack-gstr2b-capture-action",
    controlId: "capture-1",
    maxBytes: 36 * 1024 * 1024,
    signalPrefix: "gstr2b",
  };
}

function installMainWorldDom(html: string): {
  documentRef: Document;
  view: Window & typeof globalThis;
} {
  const dom = new JSDOM(`<main>${html}</main>`, {
    url: "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
  });
  const view = dom.window as unknown as Window & typeof globalThis;
  Object.defineProperty(view.URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:https://gstr2b.gst.gov.in/generated"),
    writable: true,
  });
  vi.stubGlobal("window", view);
  vi.stubGlobal("document", view.document);
  vi.stubGlobal("URL", view.URL);
  vi.stubGlobal("HTMLAnchorElement", view.HTMLAnchorElement);
  vi.stubGlobal("XMLHttpRequest", view.XMLHttpRequest);
  vi.stubGlobal("FileReader", view.FileReader);
  vi.stubGlobal("Blob", view.Blob);
  vi.stubGlobal("CSS", view.CSS);
  return { documentRef: view.document, view };
}

function installFakeXhr(view: Window & typeof globalThis, responseFactory: () => Blob) {
  class FakeXhr {
    response: Blob | null = null;
    private listeners = new Map<string, Array<() => void>>();

    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    getResponseHeader(name: string) {
      return name.toLowerCase() === "content-type" ? "application/pdf" : null;
    }

    open() {
      return undefined;
    }

    send() {
      this.response = responseFactory();
      this.listeners.get("load")?.forEach((listener) => listener());
    }
  }

  Object.defineProperty(view, "XMLHttpRequest", {
    configurable: true,
    value: FakeXhr,
  });
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
}
