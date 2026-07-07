import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capturePortalBlobDownload } from "../../src/background/main-world-blob-capture";
import type { FiledReturnsMainWorldCaptureRequest } from "../../src/core/contracts";

describe("capturePortalBlobDownload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
        "gstr2b-portal-filename-observed",
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
  vi.stubGlobal("FileReader", view.FileReader);
  vi.stubGlobal("Blob", view.Blob);
  vi.stubGlobal("CSS", view.CSS);
  return { documentRef: view.document, view };
}
