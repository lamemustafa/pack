import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capturePortalPdfBlob } from "../../src/connectors/gst/portal-blob-shim";

describe("capturePortalPdfBlob", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["dispatchEvent", "click"] as const)(
    "captures and suppresses only its exact blob URL via %s",
    async (method) => {
      const { documentRef, view, url } = environment();
      install(view, url);
      documentRef
        .querySelector("button")
        ?.addEventListener("click", () => savePdf(documentRef, view, method));
      const result = await capturePortalPdfBlob({
        controlSelector: "button",
        expectedMime: "application/pdf",
      });
      expect(result).toMatchObject({
        ok: true,
        safeSignals: [`portal-blob-shim-suppressed-via-${method}`],
      });
    },
  );

  it("captures the configured workbook MIME and ignores other blob MIME types", async () => {
    const { documentRef, view, url } = environment();
    install(view, url);
    documentRef.querySelector("button")?.addEventListener("click", () => {
      url.createObjectURL(new view.Blob(["not a workbook"], { type: "application/pdf" }));
      saveBlob(
        documentRef,
        view,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "click",
      );
    });
    await expect(
      capturePortalPdfBlob({
        controlSelector: "button",
        expectedMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).resolves.toMatchObject({ ok: true, safeSignals: ["portal-blob-shim-suppressed-via-click"] });
  });

  it("does not suppress an unrelated anchor and ignores non-matching blobs", async () => {
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
    const result = await capturePortalPdfBlob({
      controlSelector: "button",
      expectedMime: "application/pdf",
      timeoutMs: 0,
    });
    expect(result).toMatchObject({ ok: false, reason: "generation-timeout" });
    expect(click).toHaveBeenCalledOnce();
    expect(view.HTMLAnchorElement.prototype.click).toBe(originalClick);
  });

  it("does not click a generic control after its visible target changes", async () => {
    const { documentRef, view, url } = environment();
    install(view, url);
    documentRef.body.innerHTML = `
      <section><h1>GSTR-3B Monthly Return</h1><p>Tax Period: May</p>
      <p>Financial Year: 2024-25</p><button>Download</button></section>`;
    const click = vi.fn();
    documentRef.querySelector("button")?.addEventListener("click", click);

    await expect(
      capturePortalPdfBlob({
        controlSelector: "button",
        expectedMime: "application/pdf",
        expectedTarget: { financialYear: "2024-25", period: "April", returnType: "GSTR-3B" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "page-period-mismatch",
      safeSignals: ["page-target-unverified"],
    });
    expect(click).not.toHaveBeenCalled();
  });

  it("clicks only when the generic control remains in the expected detail surface", async () => {
    const { documentRef, view, url } = environment();
    install(view, url);
    documentRef.body.innerHTML = `
      <section><h1>GSTR-3B Monthly Return</h1> <p>Tax Period: April</p>
      <p>Financial Year: 2024-25</p><button>Download</button></section>`;
    documentRef
      .querySelector("button")
      ?.addEventListener("click", () => savePdf(documentRef, view, "click"));

    await expect(
      capturePortalPdfBlob({
        controlSelector: "button",
        expectedMime: "application/pdf",
        expectedTarget: { financialYear: "2024-25", period: "April", returnType: "GSTR-3B" },
      }),
    ).resolves.toMatchObject({ ok: true, safeSignals: ["portal-blob-shim-suppressed-via-click"] });
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
    const result = await capturePortalPdfBlob({
      controlSelector: "missing",
      expectedMime: "application/pdf",
      timeoutMs: 0,
    });
    expect(result).toMatchObject({ ok: false, reason: "control-not-found" });
    expect(view.HTMLAnchorElement.prototype.dispatchEvent).toBe(dispatch);
    expect(view.HTMLAnchorElement.prototype.click).toBe(click);
    expect(url.createObjectURL).toBe(create);
    expect(view.open).toBe(open);
    expect(view.fetch).toBe(fetch);
    expect(view.XMLHttpRequest).toBe(xhr);
    expect(documentRef.querySelector("button")).not.toBeNull();
  });

  it("restores every wrapper after a control throw", async () => {
    const { documentRef, view, url } = environment();
    install(view, url);
    const dispatch = view.HTMLAnchorElement.prototype.dispatchEvent;
    const click = view.HTMLAnchorElement.prototype.click;
    const create = url.createObjectURL;
    const control = documentRef.querySelector("button") as HTMLElement;
    control.click = () => {
      throw new Error("synthetic");
    };
    await expect(
      capturePortalPdfBlob({ controlSelector: "button", expectedMime: "application/pdf" }),
    ).resolves.toMatchObject({ ok: false, reason: "unexpected-content" });
    expect(view.HTMLAnchorElement.prototype.dispatchEvent).toBe(dispatch);
    expect(view.HTMLAnchorElement.prototype.click).toBe(click);
    expect(url.createObjectURL).toBe(create);
  });

  it("keeps the shim under its hard 120-line limit", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/connectors/gst/portal-blob-shim.ts", "utf8"),
    );
    expect(source.split("\n").length).toBeLessThanOrEqual(120);
  });
});

type TestWindow = Window & typeof globalThis;

function environment(): {
  documentRef: Document;
  view: TestWindow;
  url: { createObjectURL: (value: Blob) => string };
} {
  const dom = new JSDOM("<body><button>Download</button></body>", {
    url: "https://return.gst.gov.in/returns/auth/gstr3b",
  });
  return {
    documentRef: dom.window.document,
    view: dom.window as unknown as TestWindow,
    url: { createObjectURL: vi.fn(() => "blob:synthetic-pdf") },
  };
}

function install(view: TestWindow, url: { createObjectURL: (value: Blob) => string }) {
  vi.stubGlobal("HTMLAnchorElement", view.HTMLAnchorElement);
  vi.stubGlobal("Blob", view.Blob);
  vi.stubGlobal("URL", url);
  vi.stubGlobal("document", view.document);
  vi.stubGlobal("btoa", (binary: string) => Buffer.from(binary, "latin1").toString("base64"));
}

function savePdf(documentRef: Document, view: TestWindow, method: "dispatchEvent" | "click") {
  saveBlob(documentRef, view, "application/pdf", method);
}

function saveBlob(
  documentRef: Document,
  view: TestWindow,
  mimeType: string,
  method: "dispatchEvent" | "click",
) {
  const link = documentRef.createElement("a");
  link.href = URL.createObjectURL(new view.Blob(["synthetic portal bytes"], { type: mimeType }));
  documentRef.body.append(link);
  if (method === "click") link.click();
  else link.dispatchEvent(new view.MouseEvent("click"));
}
