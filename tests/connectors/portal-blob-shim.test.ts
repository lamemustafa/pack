import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capturePortalPdfBlob } from "../../src/connectors/gst/portal-blob-shim";

describe("capturePortalPdfBlob", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["dispatchEvent", "click"] as const)("captures and suppresses only its exact blob URL via %s", async (method) => {
    const { documentRef, view, url } = environment();
    install(view, url);
    documentRef.querySelector("button")?.addEventListener("click", () => savePdf(documentRef, view, method));
    const result = await capturePortalPdfBlob({ controlSelector: "button" });
    expect(result).toMatchObject({ ok: true, safeSignals: [`portal-blob-shim-suppressed-via-${method}`] });
  });

  it("does not suppress an unrelated anchor and ignores non-PDF blobs", async () => {
    const { documentRef, view, url } = environment();
    install(view, url);
    const originalClick = view.HTMLAnchorElement.prototype.click;
    const unrelated = documentRef.createElement("a");
    unrelated.href = "https://example.test/unrelated";
    const click = vi.fn();
    unrelated.addEventListener("click", click);
    documentRef.body.append(unrelated);
    documentRef.querySelector("button")?.addEventListener("click", () => {
      url.createObjectURL(new view.Blob(["not a pdf"], { type: "text/plain" }));
      unrelated.click();
    });
    const result = await capturePortalPdfBlob({ controlSelector: "button", timeoutMs: 0 });
    expect(result).toMatchObject({ ok: false, reason: "generation-timeout" });
    expect(click).toHaveBeenCalledOnce();
    expect(view.HTMLAnchorElement.prototype.click).toBe(originalClick);
  });

  it("restores every wrapped member and never patches unrelated APIs", async () => {
    const { documentRef, view, url } = environment();
    install(view, url);
    const dispatch = view.HTMLAnchorElement.prototype.dispatchEvent;
    const click = view.HTMLAnchorElement.prototype.click;
    const create = url.createObjectURL;
    const open = view.open;
    const fetch = view.fetch;
    const xhr = view.XMLHttpRequest;
    const result = await capturePortalPdfBlob({ controlSelector: "missing", timeoutMs: 0 });
    expect(result).toMatchObject({ ok: false, reason: "control-not-found" });
    expect(view.HTMLAnchorElement.prototype.dispatchEvent).toBe(dispatch);
    expect(view.HTMLAnchorElement.prototype.click).toBe(click);
    expect(url.createObjectURL).toBe(create);
    expect(view.open).toBe(open);
    expect(view.fetch).toBe(fetch);
    expect(view.XMLHttpRequest).toBe(xhr);
    expect(documentRef.querySelector("button")).not.toBeNull();
  });

  it("keeps the shim under its hard 120-line limit", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile("src/connectors/gst/portal-blob-shim.ts", "utf8"));
    expect(source.split("\n").length).toBeLessThanOrEqual(120);
  });
});

type TestWindow = Window & typeof globalThis;

function environment(): { documentRef: Document; view: TestWindow; url: { createObjectURL: (value: Blob) => string } } {
  const dom = new JSDOM('<body><button>Download</button></body>', { url: "https://return.gst.gov.in/returns/auth/gstr3b" });
  return { documentRef: dom.window.document, view: dom.window as unknown as TestWindow, url: { createObjectURL: vi.fn(() => "blob:synthetic-pdf") } };
}

function install(view: TestWindow, url: { createObjectURL: (value: Blob) => string }) {
  vi.stubGlobal("HTMLAnchorElement", view.HTMLAnchorElement);
  vi.stubGlobal("Blob", view.Blob);
  vi.stubGlobal("URL", url);
  vi.stubGlobal("document", view.document);
  vi.stubGlobal("btoa", (binary: string) => Buffer.from(binary, "latin1").toString("base64"));
}

function savePdf(documentRef: Document, view: TestWindow, method: "dispatchEvent" | "click") {
  const link = documentRef.createElement("a");
  link.href = URL.createObjectURL(new view.Blob(["%PDF-synthetic"], { type: "application/pdf" }));
  documentRef.body.append(link);
  if (method === "click") link.click();
  else link.dispatchEvent(new view.MouseEvent("click"));
}
