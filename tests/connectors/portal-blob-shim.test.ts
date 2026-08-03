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
        blobUrl: "blob:synthetic-pdf",
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

  it("keeps the GSTR-1-style local scope guard despite matching page-wide decoy text", async () => {
    const { documentRef, view, url } = environment();
    install(view, url);
    documentRef.body.innerHTML = `
      <header>GSTR-3B Tax Period: April Financial Year: 2024-25</header>
      <section><button>Download</button></section>`;
    const click = vi.fn();
    documentRef.querySelector("button")?.addEventListener("click", click);

    await expect(
      capturePortalPdfBlob({
        controlSelector: "button",
        expectedMime: "application/pdf",
        expectedTarget: { financialYear: "2024-25", period: "April", returnType: "GSTR-3B" },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "page-period-mismatch" });
    expect(click).not.toHaveBeenCalled();
  });

  it("allows a GSTR-2B control outside the scope panel when current rendered labels match", async () => {
    const gstr2b = gstr2bEnvironment();
    saveGstr2bPdf(gstr2b);

    await expect(captureGstr2b()).resolves.toMatchObject({
      ok: true,
      safeSignals: ["portal-blob-shim-suppressed-via-click"],
    });
    expect(gstr2b.alternateClick).not.toHaveBeenCalled();
  });

  it("does not click either GSTR-2B action when the request marker is ambiguous", async () => {
    const gstr2b = gstr2bEnvironment();
    gstr2b.documentRef
      .querySelectorAll("button")[1]
      ?.setAttribute("data-pack-artifact-request", "synthetic-request");

    await expectGstr2bAmbiguous(gstr2b);
  });

  it.each([
    ["hidden", (control: HTMLElement) => control.style.setProperty("display", "none")],
    ["disabled", (control: HTMLElement) => control.setAttribute("aria-disabled", "true")],
    ["inert", (control: HTMLElement) => control.setAttribute("inert", "")],
    ["transparent", (control: HTMLElement) => control.style.setProperty("opacity", "0")],
    [
      "pointer-disabled",
      (control: HTMLElement) => control.style.setProperty("pointer-events", "none"),
    ],
    [
      "zero-area",
      (control: HTMLElement) =>
        Object.defineProperty(control, "getBoundingClientRect", {
          configurable: true,
          value: () => ({ height: 0, width: 0 }),
        }),
    ],
  ] as const)("does not click a %s GSTR-2B control after it was armed", async (_name, mutate) => {
    const gstr2b = gstr2bEnvironment();
    const control = gstr2b.documentRef.querySelector<HTMLElement>(gstr2bInput.controlSelector);
    if (!control) throw new Error("Synthetic GSTR-2B control missing.");
    mutate(control);

    await expectGstr2bControlRejected(
      gstr2b,
      "control-not-actionable",
      "capture-control-not-actionable",
    );
  });

  it("does not click a GSTR-2B control whose artifact identity changed after it was armed", async () => {
    const gstr2b = gstr2bEnvironment();
    const control = gstr2b.documentRef.querySelector<HTMLElement>(gstr2bInput.controlSelector);
    if (!control) throw new Error("Synthetic GSTR-2B control missing.");
    control.textContent = "DOWNLOAD GSTR-2B DETAILS (EXCEL)";

    await expectGstr2bControlRejected(
      gstr2b,
      "control-artifact-mismatch",
      "capture-control-artifact-mismatch",
    );
  });

  it("does not accept hidden GSTR-2B artifact text as a final action identity", async () => {
    const gstr2b = gstr2bEnvironment();
    const control = gstr2b.documentRef.querySelector<HTMLElement>(gstr2bInput.controlSelector);
    if (!control) throw new Error("Synthetic GSTR-2B control missing.");
    control.innerHTML = "<span hidden>DOWNLOAD GSTR-2B SUMMARY (PDF)</span>";
    Object.defineProperty(control, "innerText", { configurable: true, value: "" });

    await expectGstr2bControlRejected(
      gstr2b,
      "control-artifact-mismatch",
      "capture-control-artifact-mismatch",
    );
  });

  it.each([
    ["visible-label mismatch", { period: "May" }],
    ["repeated visible labels", { duplicateVisibleLabels: true }],
    ["missing visible labels", { labels: false }],
  ] as const)("rejects GSTR-2B scope when %s", async (_name, options) => {
    await expectGstr2bRejected(gstr2bEnvironment(options));
  });

  it("rejects a GSTR-2B target when its page route changes before capture", async () => {
    await expectGstr2bRejected(
      gstr2bEnvironment({}, "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b"),
    );
  });

  it("does not accept hidden-text scope evidence when rendered text is unavailable", async () => {
    const gstr2b = gstr2bEnvironment();
    for (const label of gstr2bScopeLabels(gstr2b.documentRef)) {
      Object.defineProperty(label, "innerText", { configurable: true, value: "" });
    }

    await expectGstr2bRejected(gstr2b);
  });

  it.each(["collapse", "transparent", "ancestor-hidden"] as const)(
    "rejects a %s GSTR-2B scope label",
    async (state) => {
      const gstr2b = gstr2bEnvironment();
      const label = gstr2bScopeLabels(gstr2b.documentRef)[0];
      if (state === "collapse") label?.style.setProperty("visibility", "collapse");
      if (state === "transparent") label?.style.setProperty("opacity", "0");
      if (state === "ancestor-hidden") label?.parentElement?.style.setProperty("display", "none");

      await expectGstr2bRejected(gstr2b);
    },
  );

  it("rejects a zero-height GSTR-2B scope label", async () => {
    const gstr2b = gstr2bEnvironment();
    const label = gstr2bScopeLabels(gstr2b.documentRef)[0];
    Object.defineProperty(label, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ height: 0, width: 10 }),
    });

    await expectGstr2bRejected(gstr2b);
  });

  it("does not inspect unrelated page or inline-script text during GSTR-2B capture", async () => {
    const gstr2b = gstr2bEnvironment();
    Object.defineProperty(gstr2b.documentRef.body, "innerText", {
      configurable: true,
      get: () => {
        throw new Error("unrelated body text must not be read");
      },
    });
    const unrelatedScript = gstr2b.documentRef.createElement("script");
    Object.defineProperty(unrelatedScript, "textContent", {
      configurable: true,
      get: () => {
        throw new Error("unrelated script text must not be read");
      },
    });
    gstr2b.documentRef.body.append(unrelatedScript);
    const unrelatedSpan = gstr2b.documentRef.createElement("span");
    Object.defineProperty(unrelatedSpan, "innerText", {
      configurable: true,
      get: () => {
        throw new Error("unrelated span text must not be read");
      },
    });
    gstr2b.documentRef.body.append(unrelatedSpan);
    saveGstr2bPdf(gstr2b);

    await expect(captureGstr2b()).resolves.toMatchObject({
      ok: true,
      safeSignals: ["portal-blob-shim-suppressed-via-click"],
    });
  });

  it("survives Chrome's serialized MAIN-world function boundary", async () => {
    const { documentRef, view, url } = environment();
    install(view, url);
    documentRef.body.innerHTML = `
      <section><h1>GSTR-3B Monthly Return</h1> <p>Tax Period: April</p>
      <p>Financial Year: 2024-25</p><button>Download</button></section>`;
    documentRef
      .querySelector("button")
      ?.addEventListener("click", () => savePdf(documentRef, view, "click"));

    const executeInMainWorld = rebuildInMainWorld(capturePortalPdfBlob);
    await expect(
      executeInMainWorld({
        controlSelector: "button",
        expectedMime: "application/pdf",
        expectedTarget: { financialYear: "2024-25", period: "April", returnType: "GSTR-3B" },
      }),
    ).resolves.toMatchObject({ ok: true, safeSignals: ["portal-blob-shim-suppressed-via-click"] });
  });

  it("keeps the GSTR-2B scope proof intact across Chrome's serialized MAIN-world boundary", async () => {
    const gstr2b = gstr2bEnvironment();
    saveGstr2bPdf(gstr2b);

    const executeInMainWorld = rebuildInMainWorld(capturePortalPdfBlob);
    await expect(executeInMainWorld(gstr2bInput)).resolves.toMatchObject({
      ok: true,
      safeSignals: ["portal-blob-shim-suppressed-via-click"],
    });
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

  it("rejects an oversized Blob before reading it into MAIN-world memory", async () => {
    const { documentRef, view, url } = environment();
    install(view, url);
    const blob = new view.Blob([new Uint8Array(25 * 1024 * 1024 + 1)], {
      type: "application/pdf",
    });
    const read = vi.spyOn(blob, "arrayBuffer");
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const link = documentRef.createElement("a");
      link.href = url.createObjectURL(blob);
      documentRef.body.append(link);
      link.click();
    });

    await expect(
      capturePortalPdfBlob({ controlSelector: "button", expectedMime: "application/pdf" }),
    ).resolves.toMatchObject({ ok: false, reason: "too-large" });
    expect(read).not.toHaveBeenCalled();
  });
});

type TestWindow = Window & typeof globalThis;

const gstr2bInput = {
  controlSelector: '[data-pack-artifact-request="synthetic-request"]',
  expectedControlText: "DOWNLOAD GSTR-2B SUMMARY (PDF)",
  expectedMime: "application/pdf",
  expectedTarget: { financialYear: "2024-25", period: "April", returnType: "GSTR-2B" },
  timeoutMs: 0,
};

type Gstr2bEnvironment = ReturnType<typeof environment> & {
  alternateClick: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
};

function gstr2bEnvironment(
  options: Parameters<typeof gstr2bSummary>[1] = {},
  pageUrl = "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
): Gstr2bEnvironment {
  const result = environment(pageUrl);
  install(result.view, result.url);
  gstr2bSummary(result.documentRef, options);
  const click = vi.fn();
  result.documentRef.querySelector(gstr2bInput.controlSelector)?.addEventListener("click", click);
  const alternateClick = vi.fn();
  result.documentRef.querySelectorAll("button")[1]?.addEventListener("click", alternateClick);
  return { ...result, alternateClick, click };
}

function captureGstr2b() {
  return capturePortalPdfBlob(gstr2bInput);
}

async function expectGstr2bRejected({ alternateClick, click, url }: Gstr2bEnvironment) {
  await expect(captureGstr2b()).resolves.toMatchObject({
    ok: false,
    reason: "page-period-mismatch",
    safeSignals: ["page-target-unverified"],
  });
  expect(click).not.toHaveBeenCalled();
  expect(alternateClick).not.toHaveBeenCalled();
  expect(url.createObjectURL).not.toHaveBeenCalled();
}

async function expectGstr2bControlRejected(
  { alternateClick, click, url }: Gstr2bEnvironment,
  reason: "control-artifact-mismatch" | "control-not-actionable",
  safeSignal: "capture-control-artifact-mismatch" | "capture-control-not-actionable",
) {
  await expect(captureGstr2b()).resolves.toMatchObject({
    ok: false,
    reason,
    safeSignals: [safeSignal],
  });
  expect(click).not.toHaveBeenCalled();
  expect(alternateClick).not.toHaveBeenCalled();
  expect(url.createObjectURL).not.toHaveBeenCalled();
}

async function expectGstr2bAmbiguous({ alternateClick, click, url }: Gstr2bEnvironment) {
  await expect(captureGstr2b()).resolves.toMatchObject({
    ok: false,
    reason: "control-not-found",
    safeSignals: [],
  });
  expect(click).not.toHaveBeenCalled();
  expect(alternateClick).not.toHaveBeenCalled();
  expect(url.createObjectURL).not.toHaveBeenCalled();
}

function saveGstr2bPdf({ documentRef, view }: Gstr2bEnvironment) {
  documentRef
    .querySelector(gstr2bInput.controlSelector)
    ?.addEventListener("click", () => savePdf(documentRef, view, "click"));
}

function gstr2bScopeLabels(documentRef: Document): HTMLElement[] {
  return Array.from(documentRef.querySelectorAll<HTMLElement>("main > section > div > span"));
}

function environment(url = "https://return.gst.gov.in/returns/auth/gstr3b"): {
  documentRef: Document;
  view: TestWindow;
  url: { createObjectURL: (value: Blob) => string };
} {
  const dom = new JSDOM("<body><button>Download</button></body>", { url });
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
  vi.stubGlobal("location", view.location);
  vi.stubGlobal("btoa", (binary: string) => Buffer.from(binary, "latin1").toString("base64"));
}

function gstr2bSummary(
  documentRef: Document,
  options: {
    duplicateVisibleLabels?: boolean;
    labels?: boolean;
    period?: string;
  } = {},
) {
  const period = options.period ?? "April";
  documentRef.body.innerHTML = `
    <main>
      <nav>Dashboard / Returns / GSTR-2B</nav>
      <aside aria-hidden="true">
        <div><span>Financial Year - 2023-24</span></div>
        <div><span>Return Period - March</span></div>
      </aside>
      <section>
        <h1>GSTR-2B</h1>
        ${
          options.labels === false
            ? ""
            : `<div><span>Financial Year - 2024-25</span></div>
               <div><span>Return Period - ${period}</span></div>`
        }
        ${
          options.duplicateVisibleLabels
            ? `<div><span>Financial Year - 2024-25</span></div>
               <div><span>Return Period - ${period}</span></div>`
            : ""
        }
      </section>
      <section>
        <button data-pack-artifact-request="synthetic-request">DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
        <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
      </section>
    </main>`;
  for (const label of documentRef.querySelectorAll<HTMLElement>("div > span")) {
    Object.defineProperty(label, "innerText", {
      configurable: true,
      get: () => label.textContent || "",
    });
    Object.defineProperty(label, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ height: 10, width: 10 }),
    });
  }
  for (const control of documentRef.querySelectorAll<HTMLElement>("button")) {
    Object.defineProperty(control, "innerText", {
      configurable: true,
      get: () => control.textContent || "",
    });
    Object.defineProperty(control, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ height: 10, width: 10 }),
    });
  }
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

function rebuildInMainWorld<T extends (...args: never[]) => unknown>(func: T): T {
  return new Function(`"use strict"; return (${func.toString()});`)() as T;
}
