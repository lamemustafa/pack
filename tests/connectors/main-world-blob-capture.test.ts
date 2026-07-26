import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capturePortalBlobDownload,
  capturePortalBlobDownloadWithDiagnostics,
} from "../../src/connectors/gst/main-world-blob-capture";
import type { FiledReturnsMainWorldCaptureRequest } from "../../src/connectors/gst/filed-returns-contracts";

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

  it("restores capture hooks after the bounded 30-second GSTR-3B timeout", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const originalAnchorClick = function click() {};
    const originalFetch = view.fetch;
    const originalXhrOpen = view.XMLHttpRequest.prototype.open;
    const queuedTimers: Array<{ delay: number | undefined; run: () => void }> = [];
    view.HTMLAnchorElement.prototype.click = originalAnchorClick;
    view.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      queuedTimers.push({
        delay: timeout,
        run: () => {
          if (typeof handler === "function") handler(...args);
        },
      });
      return queuedTimers.length as unknown as number;
    }) as typeof view.setTimeout;

    const outcomePromise = capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      signalPrefix: "filed-gstr3b",
      timeoutMs: 30_000,
    });

    const timeout = queuedTimers.find((timer) => timer.delay === 30_000);
    expect(timeout).toBeDefined();
    timeout?.run();
    const outcome = await outcomePromise;

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("filed-gstr3b-main-world-capture-timeout");
    expect(view.HTMLAnchorElement.prototype.click).toBe(originalAnchorClick);
    expect(view.fetch).toBe(originalFetch);
    expect(view.XMLHttpRequest.prototype.open).toBe(originalXhrOpen);

    const unrelatedAnchor = documentRef.createElement("a");
    unrelatedAnchor.href = "https://example.invalid/unrelated.pdf";
    unrelatedAnchor.click();
    expect(view.HTMLAnchorElement.prototype.click).toBe(originalAnchorClick);
  });

  it("fails closed before click when the target binding is missing", async () => {
    const { documentRef } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let controlClicks = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      controlClicks += 1;
    });
    const config = {
      ...captureConfig(),
      targetBinding: undefined,
    } as unknown as FiledReturnsMainWorldCaptureRequest;

    const outcome = await capturePortalBlobDownloadWithDiagnostics(config);

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-target-binding-missing");
    expect(controlClicks).toBe(0);
  });

  it("fails closed before click when the visible period drifts after isolated verification", async () => {
    const { documentRef } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let controlClicks = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      controlClicks += 1;
    });
    const config = captureConfig();
    const periodLabel = Array.from(documentRef.querySelectorAll("p")).find((element) =>
      element.textContent?.includes("Return Period"),
    );
    if (periodLabel) periodLabel.textContent = "Return Period - June";

    const outcome = await capturePortalBlobDownloadWithDiagnostics(config);

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-target-identity-mismatch");
    expect(controlClicks).toBe(0);
  });

  it("fails closed before click when the tagged control becomes hidden or inert", async () => {
    const { documentRef } = installMainWorldDom(`
      <section data-stale>
        <button data-pack-gstr2b-capture-action="capture-1">Download</button>
      </section>
    `);
    let controlClicks = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      controlClicks += 1;
    });
    const config = captureConfig();
    documentRef.querySelector("[data-stale]")?.setAttribute("inert", "");

    const outcome = await capturePortalBlobDownloadWithDiagnostics(config);

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-control-not-actionable");
    expect(controlClicks).toBe(0);
  });

  it("fails closed before click when the verified control identity is replaced", async () => {
    const { documentRef } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let controlClicks = 0;
    const control = documentRef.querySelector("button");
    control?.addEventListener("click", () => {
      controlClicks += 1;
    });
    const config = captureConfig();
    if (control) control.textContent = "Download different artifact";

    const outcome = await capturePortalBlobDownloadWithDiagnostics(config);

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-control-fingerprint-mismatch");
    expect(controlClicks).toBe(0);
  });

  it.each([
    {
      artifactType: "PDF" as const,
      controlText: "Download Filed GSTR-3B",
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B" as const,
    },
    {
      artifactType: "PDF" as const,
      controlText: "Download (PDF)",
      path: "/returns/auth/gstr1/summary",
      returnType: "GSTR-1" as const,
    },
    {
      artifactType: "EXCEL" as const,
      controlText: "Download Details from E-Invoices (Excel)",
      path: "/returns/auth/gstr1/summary",
      returnType: "GSTR-1" as const,
    },
    {
      artifactType: "PDF" as const,
      controlText: "Download GSTR‑2B Summary (PDF)",
      path: "/gstr2b/auth/gstr2b/summary",
      returnType: "GSTR-2B" as const,
    },
    {
      artifactType: "EXCEL" as const,
      controlText: "Download GSTR-2B Details (Excel)",
      path: "/gstr2b/auth/gstr2b/summary",
      returnType: "GSTR-2B" as const,
    },
  ])(
    "accepts the unique actionable $returnType $artifactType control",
    async ({ artifactType, controlText, path, returnType }) => {
      const { documentRef, view } = installMainWorldDom(`
        <button data-pack-gstr2b-capture-action="capture-1">${controlText}</button>
      `);
      configureTestTarget(documentRef, view, { path, returnType });
      const control = documentRef.querySelector("button");
      control?.addEventListener("click", () => {
        const anchor = documentRef.createElement("a");
        anchor.href =
          artifactType === "PDF"
            ? `data:application/pdf;base64,${btoa("%PDF-1.7 synthetic")}`
            : `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${btoa("synthetic workbook")}`;
        anchor.download = artifactType === "PDF" ? "synthetic.pdf" : "synthetic.xlsx";
        anchor.click();
      });

      const outcome = await capturePortalBlobDownloadWithDiagnostics(
        captureConfig({ artifactType, returnType }),
      );

      expect(outcome.capturedDownloadRequest).toMatchObject({ actionId: "action-1" });
      expect(outcome.safeFailureSignals).toEqual([]);
    },
  );

  it.each([
    { expectedPeriod: "March" as const, label: "Mar" },
    { expectedPeriod: "September" as const, label: "Sept" },
  ])("accepts the finite $label period alias", async ({ expectedPeriod, label }) => {
    const { documentRef } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Summary PDF</button>
    `);
    const periodLabel = Array.from(documentRef.querySelectorAll("p")).find((element) =>
      element.textContent?.includes("Return Period"),
    );
    if (periodLabel) periodLabel.textContent = `Return Period - ${label}`;
    const control = documentRef.querySelector("button");
    let controlClicks = 0;
    control?.addEventListener("click", () => {
      controlClicks += 1;
    });

    const config = captureConfig({ period: expectedPeriod });
    config.timeoutMs = 5;
    const outcome = await capturePortalBlobDownloadWithDiagnostics(config);

    expect(outcome.safeFailureSignals).not.toContain("gstr2b-capture-target-identity-mismatch");
    expect(outcome.safeFailureSignals).not.toContain("gstr2b-capture-target-identity-missing");
    expect(controlClicks).toBe(1);
  });

  it("rejects a semantic route drift even when the path checksum is refreshed", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Summary PDF</button>
    `);
    const config = captureConfig();
    view.history.replaceState(null, "", "/returns/auth/gstr1/summary");
    config.targetBinding.pathnameDigest = digestTestTargetText(
      normaliseTestTargetText(view.location.pathname),
    );
    let controlClicks = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      controlClicks += 1;
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics(config);

    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-target-identity-mismatch");
    expect(controlClicks).toBe(0);
  });

  it("rejects a visible return heading that conflicts with the bound return", async () => {
    const { documentRef } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Summary PDF</button>
    `);
    const heading = documentRef.querySelector("h1");
    if (heading) heading.textContent = "GSTR-1";

    const outcome = await capturePortalBlobDownloadWithDiagnostics(captureConfig());

    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-target-identity-mismatch");
  });

  it("rejects a PDF-to-Excel control switch even when its checksum is refreshed", async () => {
    const { documentRef } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Summary PDF</button>
    `);
    const config = captureConfig();
    const control = documentRef.querySelector("button");
    if (control) control.textContent = "Details Excel";
    config.targetBinding.controlTextDigest = digestTestTargetText(readTestControlText(control));

    const outcome = await capturePortalBlobDownloadWithDiagnostics(config);

    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-control-artifact-mismatch");
  });

  it("rejects a second actionable control qualifying for the same artifact", async () => {
    installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Summary PDF</button>
      <button>Download GSTR-2B Summary (PDF)</button>
    `);

    const outcome = await capturePortalBlobDownloadWithDiagnostics(captureConfig());

    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-control-artifact-mismatch");
  });

  it.each([
    {
      name: "class-disabled control",
      mutate: (control: HTMLElement) => control.classList.add("disabled"),
    },
    {
      name: "ARIA-disabled control",
      mutate: (control: HTMLElement) => control.setAttribute("aria-disabled", "true"),
    },
    {
      name: "pointer-disabled ancestor",
      mutate: (control: HTMLElement) => {
        if (control.parentElement) control.parentElement.style.pointerEvents = "none";
      },
    },
    {
      name: "zero rendered geometry",
      mutate: (control: HTMLElement) => {
        Object.defineProperty(control, "getClientRects", { value: () => [] });
        Object.defineProperty(control, "getBoundingClientRect", {
          value: () => ({ height: 0, width: 0 }),
        });
      },
    },
  ])("rejects a $name immediately before click", async ({ mutate }) => {
    const { documentRef } = installMainWorldDom(`
      <section><button data-pack-gstr2b-capture-action="capture-1">Summary PDF</button></section>
    `);
    const control = documentRef.querySelector<HTMLElement>("button");
    if (!control) throw new Error("missing synthetic control");
    mutate(control);

    const outcome = await capturePortalBlobDownloadWithDiagnostics(captureConfig());

    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-control-not-actionable");
  });

  it("rejects conflicting GSTR-2B statement evidence", async () => {
    const { documentRef } = installMainWorldDom(`
      <p>June 2026 Auto-Drafted ITC Statement</p>
      <button data-pack-gstr2b-capture-action="capture-1">Summary PDF</button>
    `);

    const outcome = await capturePortalBlobDownloadWithDiagnostics(captureConfig());

    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-target-evidence-conflict");
    expect(
      documentRef.querySelector("button")?.hasAttribute("data-pack-gstr2b-capture-action"),
    ).toBe(false);
  });

  it("rejects conflicting GSTR-2B server evidence even when visible labels match", async () => {
    installMainWorldDom(`
      <script type="application/json">
        {"FORM_TYPE":"GSTR2B","FIN_YEAR":"2025-26","RETURN_PERIOD":"052025"}
      </script>
      <button data-pack-gstr2b-capture-action="capture-1">Summary PDF</button>
    `);

    const outcome = await capturePortalBlobDownloadWithDiagnostics(captureConfig());

    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-target-evidence-conflict");
  });

  it("rejects multiple distinct GSTR-2B server scopes", async () => {
    installMainWorldDom(`
      <script type="application/json">
        {"FORM_TYPE":"GSTR2B","FIN_YEAR":"2026-27","RETURN_PERIOD":"052026"}
      </script>
      <script type="application/json">
        {"FORM_TYPE":"GSTR2B","FIN_YEAR":"2026-27","RETURN_PERIOD":"062026"}
      </script>
      <button data-pack-gstr2b-capture-action="capture-1">Summary PDF</button>
    `);

    const outcome = await capturePortalBlobDownloadWithDiagnostics(captureConfig());

    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-target-evidence-conflict");
  });

  it("rejects multiple distinct GSTR-2B statement scopes", async () => {
    installMainWorldDom(`
      <p>May 2026 Auto-Drafted ITC Statement</p>
      <p>June 2026 Auto-Drafted ITC Statement</p>
      <button data-pack-gstr2b-capture-action="capture-1">Summary PDF</button>
    `);

    const outcome = await capturePortalBlobDownloadWithDiagnostics(captureConfig());

    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-target-evidence-conflict");
  });

  it("ignores hidden stale identity labels and rejects the visible mismatch", async () => {
    const { documentRef } = installMainWorldDom(`
      <p>Financial Year - 2025-26</p>
      <p>Return Period - June</p>
      <button data-pack-gstr2b-capture-action="capture-1">Summary PDF</button>
    `);
    for (const label of Array.from(documentRef.querySelectorAll("main > p")).slice(0, 2)) {
      label.setAttribute("hidden", "");
    }

    const outcome = await capturePortalBlobDownloadWithDiagnostics(captureConfig());

    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-target-identity-mismatch");
  });

  it("fails closed when no complete visible or server target identity exists", async () => {
    const { documentRef } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Summary PDF</button>
    `);
    for (const label of Array.from(documentRef.querySelectorAll("main > p")).slice(0, 2)) {
      label.setAttribute("hidden", "");
    }

    const outcome = await capturePortalBlobDownloadWithDiagnostics(captureConfig());

    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-target-identity-missing");
  });

  it("removes the exact capture token from every duplicate after failing closed", async () => {
    const { documentRef } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Summary PDF</button>
      <button data-pack-gstr2b-capture-action="capture-1">Summary PDF</button>
      <button data-pack-gstr2b-capture-action="newer-token">Summary PDF</button>
    `);

    const outcome = await capturePortalBlobDownloadWithDiagnostics(captureConfig());

    expect(outcome.safeFailureSignals).toContain("gstr2b-capture-control-ambiguous");
    expect(
      documentRef.querySelectorAll('[data-pack-gstr2b-capture-action="capture-1"]'),
    ).toHaveLength(0);
    expect(
      documentRef.querySelector('[data-pack-gstr2b-capture-action="newer-token"]'),
    ).not.toBeNull();
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

  it("ignores an action-bound HTML data URL and waits for the filed-return artifact", async () => {
    const { documentRef } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let nativeClicks = 0;
    documentRef.defaultView!.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const errorAnchor = documentRef.createElement("a");
      errorAnchor.href = `data:text/html;base64,${btoa("synthetic portal error")}`;
      errorAnchor.download = "error.html";
      errorAnchor.click();

      const artifactAnchor = documentRef.createElement("a");
      artifactAnchor.href = `data:application/pdf;base64,${btoa("%PDF-1.7 synthetic")}`;
      artifactAnchor.download = "may.pdf";
      artifactAnchor.click();
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(captured?.dataUrl).not.toContain("data:text/html");
    expect(nativeClicks).toBe(0);
  });

  it("suppresses an exact-action HTTPS anchor without installing a global download listener", async () => {
    const { documentRef } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let nativeClicks = 0;
    documentRef.defaultView!.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const anchor = documentRef.createElement("a");
      anchor.href = "https://gstr2b.gst.gov.in/synthetic.pdf";
      anchor.download = "may.pdf";
      anchor.click();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      timeoutMs: 20,
    });

    expect(outcome).toMatchObject({
      capturedDownloadRequest: null,
      safeFailureSignals: expect.arrayContaining([
        "gstr2b-native-https-download-suppressed",
        "gstr2b-main-world-capture-timeout",
      ]),
    });
    expect(nativeClicks).toBe(0);
  });

  it("hides Pack's native suppression from an exact HTTPS anchor handler", async () => {
    const { documentRef } = installMainWorldDom(`
      <a data-pack-gstr2b-capture-action="capture-1"
         download="may.pdf"
         href="https://gstr2b.gst.gov.in/synthetic.pdf">Download</a>
    `);
    let handlerCalls = 0;
    let handlerObservedDefaultPrevented = true;
    let handlerObservedDefaultPreventedAfterStop = false;
    let handlerObservedReturnValue = false;
    const control = documentRef.querySelector<HTMLAnchorElement>("a")!;
    control.addEventListener("click", (event) => {
      handlerCalls += 1;
      handlerObservedDefaultPrevented = event.defaultPrevented;
      handlerObservedReturnValue = event.returnValue;
      event.stopImmediatePropagation();
      handlerObservedDefaultPreventedAfterStop = event.defaultPrevented;
      const artifact = documentRef.createElement("a");
      artifact.href = `data:application/pdf;base64,${btoa("%PDF-1.7 synthetic")}`;
      artifact.download = "may.pdf";
      artifact.click();
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(handlerCalls).toBe(1);
    expect(handlerObservedDefaultPrevented).toBe(false);
    expect(handlerObservedDefaultPreventedAfterStop).toBe(false);
    expect(handlerObservedReturnValue).toBe(true);
    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(captured?.safeSignals).toContain("gstr2b-native-data-click-suppressed");
  });

  it("keeps Pack's native suppression hidden after stopPropagation", async () => {
    const { documentRef } = installMainWorldDom(`
      <a data-pack-gstr2b-capture-action="capture-1"
         download="may.pdf"
         href="https://gstr2b.gst.gov.in/synthetic.pdf">Download</a>
    `);
    let handlerObservedDefaultPreventedAfterStop = true;
    let laterHandlerObservedDefaultPrevented = true;
    const control = documentRef.querySelector<HTMLAnchorElement>("a")!;
    control.addEventListener("click", (event) => {
      event.stopPropagation();
      handlerObservedDefaultPreventedAfterStop = event.defaultPrevented;
    });
    control.addEventListener("click", (event) => {
      laterHandlerObservedDefaultPrevented = event.defaultPrevented;
      const artifact = documentRef.createElement("a");
      artifact.href = `data:application/pdf;base64,${btoa("%PDF-1.7 synthetic")}`;
      artifact.download = "may.pdf";
      artifact.click();
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(handlerObservedDefaultPreventedAfterStop).toBe(false);
    expect(laterHandlerObservedDefaultPrevented).toBe(false);
    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
  });

  it("preserves a truthy dispatch result for a suppressed portal anchor", async () => {
    const { documentRef } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let dispatchResult = false;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const portalAnchor = documentRef.createElement("a");
      portalAnchor.href = "https://gstr2b.gst.gov.in/synthetic.pdf";
      portalAnchor.download = "may.pdf";
      dispatchResult = portalAnchor.dispatchEvent(
        new documentRef.defaultView!.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        }),
      );
      if (!dispatchResult) return;
      const artifact = documentRef.createElement("a");
      artifact.href = `data:application/pdf;base64,${btoa("%PDF-1.7 synthetic")}`;
      artifact.download = "may.pdf";
      artifact.click();
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(dispatchResult).toBe(true);
    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
  });

  it("preserves a false dispatch result when the portal cancels the event", async () => {
    const { documentRef } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    let dispatchResult = true;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const portalAnchor = documentRef.createElement("a");
      portalAnchor.href = "https://gstr2b.gst.gov.in/synthetic.pdf";
      portalAnchor.download = "may.pdf";
      portalAnchor.addEventListener("click", (event) => {
        event.preventDefault();
        const artifact = documentRef.createElement("a");
        artifact.href = `data:application/pdf;base64,${btoa("%PDF-1.7 synthetic")}`;
        artifact.download = "may.pdf";
        artifact.click();
      });
      dispatchResult = portalAnchor.dispatchEvent(
        new documentRef.defaultView!.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(dispatchResult).toBe(false);
    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
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

  it("captures a delayed window.open for a blob URL created by the exact action", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const blobUrl = view.URL.createObjectURL(
        new view.Blob(["%PDF-1.7 synthetic"], { type: "application/pdf" }),
      );
      view.setTimeout(() => view.open(blobUrl), 0);
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(captured?.safeSignals).toContain("gstr2b-native-window-open-suppressed");
  });

  it("keeps a timer scheduled by the exact action bound until its callback runs", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    documentRef.querySelector("button")?.addEventListener("click", () => {
      view.setTimeout(() => {
        void view.Promise.resolve().then(() => {
          const blobUrl = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 synthetic"], { type: "application/pdf" }),
          );
          const anchor = documentRef.createElement("a");
          anchor.href = blobUrl;
          anchor.download = "may.pdf";
          anchor.click();
        });
      }, 0);
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(captured?.safeSignals).toContain("gstr2b-main-world-capture");
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

  it("supports child document open, variadic write, and writeln handoffs", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
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
      const childDocument = childWindow?.document.open();
      childDocument?.write('<iframe src="', "blob:https://gstr2b.gst.gov.in/generated", '">');
      childDocument?.writeln("</iframe>");
      childDocument?.close();
    });

    const captured = await capturePortalBlobDownload(captureConfig());

    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(captured?.safeSignals).toContain("gstr2b-native-window-open-suppressed");
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

  it("captures a delayed PDF Blob only after the verified action's non-artifact XHR completes", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => {
          scheduleUnbound(dispatch, 0);
        },
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      const anchor = documentRef.createElement("a");
      anchor.download = "period.pdf";
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        void view.Promise.resolve().then(() => {
          const blob = new view.Blob(["%PDF-1.7 action-bound async bytes"], {
            type: "application/pdf",
          });
          Object.defineProperty(anchor, "href", {
            configurable: true,
            value: view.URL.createObjectURL(blob),
          });
          anchor.click();
        });
      });
      xhr.send();
    });

    const captured = await capturePortalBlobDownload({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 50,
    });

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

  it("captures the target-shaped GSTR-3B PDF from ordered loadend listeners before deferred close", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    const listenerOrder: string[] = [];
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("loadend", () => listenerOrder.push("first"));
      xhr.addEventListener("loadend", () => {
        listenerOrder.push("capture");
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 loadend listener bytes"], { type: "application/pdf" }),
        );
        anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 50,
    });

    expect(listenerOrder).toEqual(["first", "capture"]);
    expect(outcome.capturedDownloadRequest).toMatchObject({ actionId: "action-1" });
    expect(outcome.capturedDownloadRequest?.dataUrl).toContain("data:application/pdf;base64,");
    expect(JSON.stringify(outcome)).not.toContain("A1B2C3D4E5F6G7H");
    expect(nativeClicks).toBe(0);
  });

  it("captures the target-shaped GSTR-3B PDF from an onloadend property handler", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let callbackThisMatched = false;
    let handlerIdentityMatched = false;
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      const handler = function handler(this: XMLHttpRequest, event: ProgressEvent<EventTarget>) {
        callbackThisMatched = this === xhr && event.type === "loadend";
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 onloadend property bytes"], { type: "application/pdf" }),
        );
        anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026";
        anchor.click();
      };
      xhr.onloadend = handler;
      handlerIdentityMatched = xhr.onloadend === handler;
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 50,
    });

    expect(callbackThisMatched).toBe(true);
    expect(handlerIdentityMatched).toBe(true);
    expect(outcome.capturedDownloadRequest).toMatchObject({ actionId: "action-1" });
    expect(outcome.capturedDownloadRequest?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeClicks).toBe(0);
  });

  it("captures the target-shaped GSTR-3B PDF in the first reaction of a Promise registered before loadend", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let resolvePagePromise: (() => void) | undefined;
    const pagePromise = new view.Promise<void>((resolve) => {
      resolvePagePromise = resolve;
    });
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    void pagePromise.then(() => {
      const anchor = documentRef.createElement("a");
      anchor.href = view.URL.createObjectURL(
        new view.Blob(["%PDF-1.7 pre-registered Promise bytes"], {
          type: "application/pdf",
        }),
      );
      anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
      anchor.click();
    });
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("loadend", () => resolvePagePromise?.());
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 50,
    });

    expect(outcome.capturedDownloadRequest).toMatchObject({ actionId: "action-1" });
    expect(outcome.capturedDownloadRequest?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeClicks).toBe(0);
  });

  it("captures the target-shaped GSTR-3B PDF after one await in an async onloadend handler", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.onloadend = async () => {
        await view.Promise.resolve();
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 async onloadend bytes"], { type: "application/pdf" }),
        );
        anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026";
        anchor.click();
      };
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 50,
    });

    expect(outcome.capturedDownloadRequest).toMatchObject({ actionId: "action-1" });
    expect(outcome.capturedDownloadRequest?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeClicks).toBe(0);
  });

  it("leaves a non-target-shaped GSTR-3B PDF in the first pre-registered Promise reaction native", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let resolvePagePromise: (() => void) | undefined;
    const pagePromise = new view.Promise<void>((resolve) => {
      resolvePagePromise = resolve;
    });
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    void pagePromise.then(() => {
      const anchor = documentRef.createElement("a");
      anchor.href = view.URL.createObjectURL(
        new view.Blob(["%PDF-1.7 noncanonical Promise bytes"], {
          type: "application/pdf",
        }),
      );
      anchor.download = "synthetic.pdf";
      anchor.click();
    });
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("loadend", () => resolvePagePromise?.());
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-main-world-capture-timeout");
    expect(nativeClicks).toBe(1);
  });

  it("leaves a target-shaped GSTR-3B PDF in a second nested microtask native", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let resolvePagePromise: (() => void) | undefined;
    const pagePromise = new view.Promise<void>((resolve) => {
      resolvePagePromise = resolve;
    });
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    void pagePromise.then(() => {
      void view.Promise.resolve().then(() => {
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 second microtask bytes"], {
            type: "application/pdf",
          }),
        );
        anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
        anchor.click();
      });
    });
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("loadend", () => resolvePagePromise?.());
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-main-world-capture-timeout");
    expect(nativeClicks).toBe(1);
  });

  it("leaves a target-shaped GSTR-3B PDF after two sequential awaits native", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.onloadend = async () => {
        await view.Promise.resolve();
        await view.Promise.resolve();
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 second sequential await bytes"], {
            type: "application/pdf",
          }),
        );
        anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
        anchor.click();
      };
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-main-world-capture-timeout");
    expect(nativeClicks).toBe(1);
  });

  it("captures a target-shaped GSTR-3B PDF when a loadend Promise resolves inside the closed-selection lease", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let resolvePendingPromise: (() => void) | undefined;
    const pendingPromise = new view.Promise<void>((resolve) => {
      resolvePendingPromise = resolve;
    });
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.onloadend = async () => {
        await pendingPromise;
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 later Promise bytes"], { type: "application/pdf" }),
        );
        anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026";
        anchor.click();
      };
      xhr.send();
      scheduleUnbound(() => resolvePendingPromise?.(), 5);
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toMatchObject({ actionId: "action-1" });
    expect(outcome.capturedDownloadRequest?.dataUrl).toContain("data:application/pdf;base64,");
    expect(JSON.stringify(outcome)).not.toContain("A1B2C3D4E5F6G7H");
    expect(nativeClicks).toBe(0);
  });

  it("captures the exact GSTR-3B PDF after the bound load callback closes before a cached timer runs", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        scheduleUnbound(() => {
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 closed-selection load bytes"], {
              type: "application/pdf",
            }),
          );
          anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
          anchor.click();
          anchor.click();
        }, 5);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 40,
    });

    expect(outcome.capturedDownloadRequest).toMatchObject({ actionId: "action-1" });
    expect(outcome.capturedDownloadRequest?.dataUrl).toContain("data:application/pdf;base64,");
    expect(JSON.stringify(outcome)).not.toContain("A1B2C3D4E5F6G7H");
    expect(nativeClicks).toBe(0);
  });

  it("keeps the exact selected load binding for one delayed Promise continuation", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let resolvePendingPromise: (() => void) | undefined;
    const pendingPromise = new view.Promise<void>((resolve) => {
      resolvePendingPromise = resolve;
    });
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        void pendingPromise.then(() => {
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 delayed Promise continuation bytes"], {
              type: "application/pdf",
            }),
          );
          anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
          anchor.click();
        });
        scheduleUnbound(() => resolvePendingPromise?.(), 5);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 40,
    });

    expect(nativeClicks, outcome.safeFailureSignals.join(" | ")).toBe(0);
    expect(outcome.capturedDownloadRequest, outcome.safeFailureSignals.join(" | ")).toMatchObject({
      actionId: "action-1",
    });
    expect(outcome.capturedDownloadRequest?.dataUrl).toContain("data:application/pdf;base64,");
    expect(JSON.stringify(outcome)).not.toContain("A1B2C3D4E5F6G7H");
  });

  it("expires a reserved Promise continuation by its absolute deadline", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let resolvePendingPromise: (() => void) | undefined;
    const pendingPromise = new view.Promise<void>((resolve) => {
      resolvePendingPromise = resolve;
    });
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        void pendingPromise.then(() => {
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 expired Promise continuation bytes"], {
              type: "application/pdf",
            }),
          );
          anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
          anchor.click();
        });
        scheduleUnbound(() => {
          now = 1_001;
          resolvePendingPromise?.();
        }, 5);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 40,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it("does not reactivate a reserved Promise continuation after capture restoration", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let resolvePendingPromise: (() => void) | undefined;
    const pendingPromise = new view.Promise<void>((resolve) => {
      resolvePendingPromise = resolve;
    });
    const originalCreateObjectUrl = view.URL.createObjectURL;
    let nativeClicks = 0;
    const originalClick = function click() {
      nativeClicks += 1;
    };
    view.HTMLAnchorElement.prototype.click = originalClick;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        void pendingPromise.then(() => {
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 post-restore Promise bytes"], {
              type: "application/pdf",
            }),
          );
          anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
          anchor.click();
        });
        scheduleUnbound(() => resolvePendingPromise?.(), 15);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 5,
    });
    await new view.Promise<void>((resolve) => scheduleUnbound(resolve, 25));

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-main-world-capture-timeout");
    expect(view.URL.createObjectURL).toBe(originalCreateObjectUrl);
    expect(view.HTMLAnchorElement.prototype.click).toBe(originalClick);
    expect(nativeClicks).toBe(1);
  });

  it("does not let an unwrapped second Promise reaction consume the reserved lease", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    const reservedPromise = new view.Promise<void>(() => undefined);
    let resolveUnwrappedPromise: (() => void) | undefined;
    const unwrappedPromise = new view.Promise<void>((resolve) => {
      resolveUnwrappedPromise = resolve;
    });
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        void reservedPromise.then(() => undefined);
        void unwrappedPromise.then(() => {
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 unwrapped second Promise bytes"], {
              type: "application/pdf",
            }),
          );
          anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
          anchor.click();
        });
        scheduleUnbound(() => resolveUnwrappedPromise?.(), 5);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 40,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it("leaves a late GSTR-3B PDF with the wrong period native", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        scheduleUnbound(() => {
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 wrong-period closed-selection bytes"], {
              type: "application/pdf",
            }),
          );
          anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_042026.pdf";
          anchor.click();
        }, 5);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 40,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-main-world-capture-timeout");
    expect(nativeClicks).toBe(1);
  });

  it("invalidates the closed-selection lease when a second Blob URL is created", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        scheduleUnbound(() => {
          view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 first closed-selection bytes"], {
              type: "application/pdf",
            }),
          );
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 second closed-selection bytes"], {
              type: "application/pdf",
            }),
          );
          anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
          anchor.click();
        }, 5);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 40,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it("expires the closed-selection lease before a late target-shaped Blob", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    const leaseExpiryTimers = interceptWindowTimeout(view, 1_000);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        scheduleUnbound(() => {
          leaseExpiryTimers[0]?.();
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 expired closed-selection bytes"], {
              type: "application/pdf",
            }),
          );
          anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
          anchor.click();
        }, 5);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 40,
    });

    expect(leaseExpiryTimers).toHaveLength(1);
    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-main-world-capture-timeout");
    expect(nativeClicks).toBe(1);
  });

  it("captures the exact late GSTR-3B PDF through dispatchEvent", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let dispatchResult = false;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        scheduleUnbound(() => {
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 closed-selection dispatch bytes"], {
              type: "application/pdf",
            }),
          );
          anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
          dispatchResult = anchor.dispatchEvent(
            new view.MouseEvent("click", { bubbles: true, cancelable: true }),
          );
        }, 5);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 40,
    });

    expect(dispatchResult).toBe(true);
    expect(outcome.capturedDownloadRequest).toMatchObject({ actionId: "action-1" });
    expect(outcome.capturedDownloadRequest?.dataUrl).toContain("data:application/pdf;base64,");
    expect(JSON.stringify(outcome)).not.toContain("A1B2C3D4E5F6G7H");
  });

  it("does not capture a late exact GSTR-3B PDF before click suppression is verified", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        scheduleUnbound(() => {
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 prevented closed-selection bytes"], {
              type: "application/pdf",
            }),
          );
          anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
          anchor.addEventListener("click", (event) => event.preventDefault());
          anchor.click();
        }, 5);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 40,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-main-world-capture-timeout");
  });

  it("invalidates the closed-selection lease when its provisional URL is revoked", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    Object.defineProperty(view.URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        scheduleUnbound(() => {
          const anchor = documentRef.createElement("a");
          const blobUrl = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 revoked closed-selection bytes"], {
              type: "application/pdf",
            }),
          );
          view.URL.revokeObjectURL(blobUrl);
          anchor.href = blobUrl;
          anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
          anchor.click();
        }, 5);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 40,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-main-world-capture-timeout");
    expect(nativeClicks).toBe(1);
  });

  it("invalidates the closed-selection lease on a repeated trusted load event", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
        scheduleRepeatedEvent: (dispatch) => scheduleUnbound(() => dispatch("load"), 5),
      },
    );
    let loadCalls = 0;
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        loadCalls += 1;
        if (loadCalls !== 1) return;
        scheduleUnbound(() => {
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 repeated closed-selection bytes"], {
              type: "application/pdf",
            }),
          );
          anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
          anchor.click();
        }, 10);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 45,
    });

    expect(loadCalls).toBe(2);
    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it("invalidates the closed-selection lease when another XHR opens before the sink", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        scheduleUnbound(() => {
          const competingXhr = new view.XMLHttpRequest();
          competingXhr.open("GET", "/returns/auth/gstr3b/secondary");
          competingXhr.send();
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 competing-XHR closed-selection bytes"], {
              type: "application/pdf",
            }),
          );
          anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
          anchor.click();
        }, 5);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 45,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it("unlinks ordered loadend callback bindings before a second nested microtask", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    const queueNativeMicrotask = view.queueMicrotask.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    const callbackOrder: string[] = [];
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("loadend", () => callbackOrder.push("first"));
      xhr.addEventListener("loadend", () => {
        callbackOrder.push("second");
        queueNativeMicrotask(() => {
          callbackOrder.push("first-hop");
          queueNativeMicrotask(() => {
            callbackOrder.push("second-hop");
            const anchor = documentRef.createElement("a");
            anchor.href = view.URL.createObjectURL(
              new view.Blob(["%PDF-1.7 ordered callbacks bytes"], {
                type: "application/pdf",
              }),
            );
            anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
            anchor.click();
          });
        });
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(callbackOrder).toEqual(["first", "second", "first-hop", "second-hop"]);
    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-main-world-capture-timeout");
    expect(nativeClicks).toBe(1);
  });

  it("uses the captured native microtask scheduler when a loadend handler replaces it", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    const replacementQueueMicrotask = vi.fn(() => undefined);
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("loadend", async () => {
        Object.defineProperty(view, "queueMicrotask", {
          configurable: true,
          value: replacementQueueMicrotask,
          writable: true,
        });
        await view.Promise.resolve();
        await view.Promise.resolve();
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 replaced scheduler bytes"], {
            type: "application/pdf",
          }),
        );
        anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026";
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(view.queueMicrotask).toBe(replacementQueueMicrotask);
    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-main-world-capture-timeout");
    expect(nativeClicks).toBe(1);
  });

  it.each([
    { download: "GSTR3B_052026.pdf", name: "a missing opaque segment" },
    {
      download: "GSTR3B_A1B2C3D4E5F6G7H_EXTRA_052026.pdf",
      name: "an extra segment",
    },
    { download: "GSTR3B_A1B2C3D4E5F6G7H_042026.pdf", name: "the wrong period" },
    {
      download: "/GSTR3B_A1B2C3D4E5F6G7H_052026.pdf",
      name: "a path separator",
    },
    {
      download: "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf ",
      name: "trailing whitespace",
    },
    {
      download: "GSTR3B_A1B2C3D4E5F6G7H_052026_052026.pdf",
      name: "a duplicate period suffix",
    },
    {
      download: "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf.pdf",
      name: "a double extension",
    },
    {
      download: "GSTR3B_A1B2C3D4E5F6G7H_052026 (1)",
      name: "a browser duplicate suffix",
    },
    {
      download: "GSTR3B_A1B2C3D4E5F6G7H_052026.PDF",
      name: "an uppercase extension",
    },
    {
      download: "GSTR3B_A1B2C3D4E5F6G7_052026.pdf",
      name: "a short opaque segment",
    },
    {
      download: "GSTR3B_A1B2C3D4E5F6G7H8_052026.pdf",
      name: "a long opaque segment",
    },
    {
      download: "GSTR3B_A1B2C3D4E5F6g7H_052026.pdf",
      name: "a non-uppercase opaque character",
    },
    {
      download: "GSTR3B_A1B2C3D4E5F6-7H_052026.pdf",
      name: "a non-alphanumeric opaque character",
    },
    {
      download: "GSTR3B_A1B2C3D4E5F6G7H_052026.txt",
      name: "an unexpected extension",
    },
  ])("leaves $name native after loadend", async ({ download }) => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("loadend", () => {
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 wrong filename bytes"], { type: "application/pdf" }),
        );
        anchor.download = download;
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-main-world-capture-timeout");
    expect(nativeClicks).toBe(1);
  });

  it("does not admit loadend Blob capture outside the bound GSTR-3B PDF target", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr2b/generated");
      xhr.addEventListener("loadend", () => {
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 wrong target bytes"], { type: "application/pdf" }),
        );
        anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-main-world-capture-timeout");
    expect(nativeClicks).toBe(1);
  });

  it.each([
    {
      captureOnCall: 2,
      fakeOptions: { loadEndDispatchCount: 2 },
      name: "a second distinct trusted loadend",
    },
    {
      captureOnCall: 1,
      fakeOptions: { trustedEvents: false },
      name: "an untrusted loadend",
    },
    {
      captureOnCall: 1,
      fakeOptions: { status: 500 },
      name: "a non-2xx loadend",
    },
    {
      captureOnCall: 1,
      fakeOptions: { status: 0, terminalEvent: "abort" as const },
      name: "loadend after abort",
    },
    {
      captureOnCall: 1,
      fakeOptions: { status: 0, terminalEvent: "error" as const },
      name: "loadend after error",
    },
    {
      captureOnCall: 1,
      fakeOptions: { status: 0, terminalEvent: "timeout" as const },
      name: "loadend after timeout",
    },
  ])("fails closed for $name", async ({ captureOnCall, fakeOptions }) => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
        ...fakeOptions,
      },
    );
    let loadEndCalls = 0;
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("loadend", () => {
        loadEndCalls += 1;
        if (loadEndCalls !== captureOnCall) return;
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 rejected loadend bytes"], { type: "application/pdf" }),
        );
        anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig({ returnType: "GSTR-3B" }),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-main-world-capture-timeout");
    expect(nativeClicks).toBe(1);
  });

  it.each([
    {
      eventType: "readystatechange" as const,
      signal: "gstr2b-xhr-page-callback-bound-readystatechange",
    },
    { eventType: "load" as const, signal: "gstr2b-xhr-page-callback-bound-load" },
    { eventType: "loadend" as const, signal: "gstr2b-xhr-page-callback-bound-loadend" },
  ])(
    "invalidates a reserved timer after a delayed distinct $eventType event",
    async ({ eventType, signal }) => {
      const { documentRef, view } = installMainWorldDom(`
        <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
      `);
      configureTestTarget(documentRef, view, {
        path: "/returns/auth/gstr3b",
        returnType: "GSTR-3B",
      });
      const scheduleUnbound = view.setTimeout.bind(view);
      installFakeXhr(
        view,
        () => new view.Blob(["synthetic response"], { type: "application/json" }),
        {
          contentType: "application/json",
          scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
          scheduleRepeatedEvent: (dispatch) => {
            scheduleUnbound(() => dispatch(eventType), 5);
          },
        },
      );
      let eventCalls = 0;
      let nativeClicks = 0;
      view.HTMLAnchorElement.prototype.click = function click() {
        nativeClicks += 1;
      };
      documentRef.querySelector("button")?.addEventListener("click", () => {
        const xhr = new view.XMLHttpRequest();
        xhr.open("GET", "/returns/auth/gstr3b/generated");
        xhr.addEventListener(eventType, () => {
          eventCalls += 1;
          if (eventCalls !== 1) return;
          view.setTimeout(() => {
            const anchor = documentRef.createElement("a");
            anchor.href = view.URL.createObjectURL(
              new view.Blob(["%PDF-1.7 repeated-event timer bytes"], {
                type: "application/pdf",
              }),
            );
            anchor.download = "GSTR3B_A1B2C3D4E5F6G7H_052026.pdf";
            anchor.click();
          }, 15);
        });
        xhr.send();
      });

      const outcome = await capturePortalBlobDownloadWithDiagnostics({
        ...captureConfig({ returnType: "GSTR-3B" }),
        asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
        timeoutMs: 40,
      });

      expect(eventCalls).toBe(2);
      expect(outcome.capturedDownloadRequest).toBeNull();
      expect(outcome.safeFailureSignals).toEqual(
        expect.arrayContaining([
          signal,
          "gstr2b-xhr-selection-closed-with-context",
          "gstr2b-unbound-create-object-url-ignored",
          "gstr2b-unbound-create-object-url-no-open-selection",
          "gstr2b-main-world-capture-timeout",
        ]),
      );
      expect(nativeClicks).toBe(1);
    },
  );

  it("keeps the first Promise continuation granted when a catch handler is attached", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      const anchor = documentRef.createElement("a");
      anchor.download = "period.pdf";
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        void view.Promise.resolve()
          .then(() => {
            Object.defineProperty(anchor, "href", {
              configurable: true,
              value: view.URL.createObjectURL(
                new view.Blob(["%PDF-1.7 caught-chain bytes"], { type: "application/pdf" }),
              ),
            });
            anchor.click();
          })
          .catch(() => undefined);
      });
      xhr.send();
    });

    const captured = await capturePortalBlobDownload({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 50,
    });

    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeClicks).toBe(0);
  });

  it.each([
    { assignBeforeOpen: true, property: "onreadystatechange" as const },
    { assignBeforeOpen: false, property: "onload" as const },
  ])(
    "interposes $property property handlers without changing callback identity",
    async ({ assignBeforeOpen, property }) => {
      const { documentRef, view } = installMainWorldDom(`
        <button data-pack-gstr2b-capture-action="capture-1">Download</button>
      `);
      const scheduleUnbound = view.setTimeout.bind(view);
      installFakeXhr(
        view,
        () => new view.Blob(["synthetic response"], { type: "application/json" }),
        {
          contentType: "application/json",
          scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
        },
      );
      let callbackEventType: string | null = null;
      let callbackThisMatched = false;
      let nativeClicks = 0;
      view.HTMLAnchorElement.prototype.click = function click() {
        nativeClicks += 1;
      };
      documentRef.querySelector("button")?.addEventListener("click", () => {
        const xhr = new view.XMLHttpRequest();
        const anchor = documentRef.createElement("a");
        anchor.download = "period.pdf";
        const handler = function handler(this: XMLHttpRequest, event: Event) {
          if (this.readyState !== 4) return;
          callbackThisMatched = this === xhr;
          callbackEventType = event.type;
          Object.defineProperty(anchor, "href", {
            configurable: true,
            value: view.URL.createObjectURL(
              new view.Blob(["%PDF-1.7 property-handler bytes"], {
                type: "application/pdf",
              }),
            ),
          });
          anchor.click();
        };
        if (assignBeforeOpen) xhr[property] = handler;
        xhr.open("GET", "/returns/auth/gstr3b/generated");
        if (!assignBeforeOpen) xhr[property] = handler;
        expect(xhr[property]).toBe(handler);
        xhr.send();
      });

      const captured = await capturePortalBlobDownload({
        ...captureConfig(),
        asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
        timeoutMs: 250,
      });

      expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
      expect(callbackThisMatched).toBe(true);
      expect(callbackEventType).toBe(property === "onload" ? "load" : "readystatechange");
      expect(nativeClicks).toBe(0);
    },
  );

  it("preserves removal of an interposed XHR listener", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let calls = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      const listener = { handleEvent: () => (calls += 1) };
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", listener);
      xhr.removeEventListener("load", listener);
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 15,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(calls).toBe(0);
  });

  it("preserves AbortSignal removal for an interposed XHR listener", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let calls = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      const abortController = new view.AbortController();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => (calls += 1), {
        signal: abortController.signal,
      });
      abortController.abort();
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 15,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(calls).toBe(0);
  });

  it("snapshots mutable listener options before restoring a page listener", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      { contentType: "application/json", scheduleLoad: () => undefined },
    );
    let calls = 0;
    let xhr: XMLHttpRequest | null = null;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      xhr = new view.XMLHttpRequest();
      const mutableOptions = { once: true };
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener(
        "load",
        () => {
          calls += 1;
        },
        mutableOptions,
      );
      mutableOptions.once = false;
      xhr.send();
    });

    await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 5,
    });
    (xhr as XMLHttpRequest | null)?.dispatchEvent(new view.Event("load"));
    (xhr as XMLHttpRequest | null)?.dispatchEvent(new view.Event("load"));

    expect(calls).toBe(1);
  });

  it("preserves once-listener re-registration from inside its callback", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => {
          scheduleUnbound(dispatch, 0);
          scheduleUnbound(dispatch, 5);
        },
      },
    );
    let calls = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      const listener = () => {
        calls += 1;
        if (calls === 1) xhr.addEventListener("load", listener, { once: true });
      };
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", listener, { once: true });
      xhr.send();
    });

    await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(calls).toBe(2);
  });

  it("does not reorder unrelated XHR listeners registered outside the portal action", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    const xhr = new view.XMLHttpRequest();
    const nativeAddEventListener = xhr.addEventListener;
    const calls: string[] = [];
    const registered = new Promise<void>((resolve) => {
      scheduleUnbound(() => {
        xhr.addEventListener("load", () => calls.push("first"));
        Reflect.apply(nativeAddEventListener, xhr, ["load", () => calls.push("second")]);
        resolve();
      }, 0);
    });

    const capture = capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 10,
    });
    await registered;
    await capture;
    xhr.dispatchEvent(new view.Event("load"));

    expect(calls).toEqual(["first", "second"]);
    expect(documentRef.querySelector("button")).not.toBeNull();
  });

  it("does not wrap an unrelated XHR property handler outside the portal action", async () => {
    const { view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    const xhr = new view.XMLHttpRequest();
    const handler = () => undefined;
    let onloadDescriptor: PropertyDescriptor | undefined;
    let prototype: object | null = view.XMLHttpRequest.prototype;
    while (prototype && !onloadDescriptor) {
      onloadDescriptor = Object.getOwnPropertyDescriptor(prototype, "onload");
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    let nativeStoredHandler: unknown;
    const assigned = new Promise<void>((resolve) => {
      scheduleUnbound(() => {
        xhr.onload = handler;
        nativeStoredHandler = onloadDescriptor?.get?.call(xhr);
        resolve();
      }, 0);
    });

    const capture = capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 10,
    });
    await assigned;
    await capture;

    expect(nativeStoredHandler).toBe(handler);
    expect(xhr.onload).toBe(handler);
  });

  it("does not arm async PDF capture from an untrusted XHR event", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
        trustedEvents: false,
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 untrusted-event bytes"], { type: "application/pdf" }),
        );
        anchor.download = "untrusted.pdf";
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-unbound-create-object-url-ignored");
    expect(nativeClicks).toBe(1);
  });

  it("invalidates a provisional PDF when the selected XHR is reopened before its sink", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      { contentType: "application/json" },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.download = "reopened.pdf";
        const blobUrl = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 provisional bytes"], { type: "application/pdf" }),
        );
        xhr.open("GET", "/returns/auth/gstr3b/reopened");
        Object.defineProperty(anchor, "href", { configurable: true, value: blobUrl });
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(nativeClicks).toBe(1);
  });

  it("keeps the exact GSTR-3B action filename through the native click handoff, then restores it", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    const delayedFilenameRestores = interceptWindowTimeout(view, 100);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      { contentType: "application/json" },
    );
    let nativeClicks = 0;
    let delegatedAnchor: HTMLAnchorElement | null = null;
    const delegatedFilename = () => delegatedAnchor?.download ?? null;
    let filenameDuringNativeClick: string | null = null;
    let filenameAfterNativeClick: string | null = null;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
      filenameDuringNativeClick = this.download;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        delegatedAnchor = anchor;
        anchor.download = "GSTR3B_000000000000000_052026.pdf";
        const blobUrl = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 provisional bytes"], { type: "application/pdf" }),
        );
        xhr.open("GET", "/returns/auth/gstr3b/reopened");
        Object.defineProperty(anchor, "href", { configurable: true, value: blobUrl });
        anchor.click();
        filenameAfterNativeClick = anchor.download;
      });
      xhr.send();
    });
    const config = captureConfig({ returnType: "GSTR-3B" });
    config.actionId = "00000000-0000-4000-8000-000000000001";
    config.signalPrefix = "filed-gstr3b";
    config.targetBoundNativeFilenameNonce = "00000000000040008000000000000001";

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...config,
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome).toMatchObject({
      capturedDownloadRequest: null,
      safeFailureSignals: expect.arrayContaining([
        "filed-gstr3b-main-world-capture-armed",
        "filed-gstr3b-target-bound-native-blob-click-delegated",
      ]),
    });
    expect(outcome.safeFailureSignals).not.toContain("filed-gstr3b-main-world-capture-timeout");
    expect(typeof outcome.targetBoundNativeDelegatedAt).toBe("string");
    expect(new Date(outcome.targetBoundNativeDelegatedAt ?? "").toISOString()).toBe(
      outcome.targetBoundNativeDelegatedAt,
    );
    expect(filenameDuringNativeClick).toBe(
      "GSTR3B_052026_pack-00000000000040008000000000000001.pdf",
    );
    expect(filenameAfterNativeClick).toBe(
      "GSTR3B_052026_pack-00000000000040008000000000000001.pdf",
    );
    expect(delayedFilenameRestores).toHaveLength(1);
    delayedFilenameRestores[0]?.();
    expect(delegatedFilename()).toBe("GSTR3B_000000000000000_052026.pdf");
    expect(nativeClicks).toBe(1);
  });

  it("delegates a verified native GSTR-3B blob anchor instead of suppressing it for capture", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    const delayedFilenameRestores = interceptWindowTimeout(view, 100);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    let filenameDuringNativeClick: string | null = null;
    view.HTMLAnchorElement.prototype.click = function click() {
      filenameDuringNativeClick = this.download;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const anchor = documentRef.createElement("a");
      anchor.download = "GSTR3B_000000000000000_052026.pdf";
      Object.defineProperty(anchor, "href", {
        configurable: true,
        value: view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 native bytes"], { type: "application/pdf" }),
        ),
      });
      anchor.click();
    });
    const config = captureConfig({ returnType: "GSTR-3B" });
    config.signalPrefix = "filed-gstr3b";
    config.targetBoundNativeFilenameNonce = "00000000000040008000000000000001";

    const outcome = await capturePortalBlobDownloadWithDiagnostics({ ...config, timeoutMs: 20 });

    expect(outcome.safeFailureSignals).toContain(
      "filed-gstr3b-target-bound-native-blob-click-delegated",
    );
    expect(filenameDuringNativeClick).toBe(
      "GSTR3B_052026_pack-00000000000040008000000000000001.pdf",
    );
    expect(delayedFilenameRestores).toHaveLength(1);
  });

  it("restores immediately when the captured native handoff timer rejects scheduling", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    const failingSetTimeout = failWindowTimeoutAtDelay(view, 100);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      { contentType: "application/json" },
    );
    let delegatedAnchor: HTMLAnchorElement | null = null;
    const delegatedFilename = () => delegatedAnchor?.download ?? null;
    let filenameDuringNativeClick: string | null = null;
    view.HTMLAnchorElement.prototype.click = function click() {
      filenameDuringNativeClick = this.download;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        delegatedAnchor = anchor;
        anchor.download = "GSTR3B_000000000000000_052026.pdf";
        const blobUrl = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 provisional bytes"], { type: "application/pdf" }),
        );
        xhr.open("GET", "/returns/auth/gstr3b/reopened");
        Object.defineProperty(anchor, "href", { configurable: true, value: blobUrl });
        anchor.click();
      });
      xhr.send();
    });
    const config = captureConfig({ returnType: "GSTR-3B" });
    config.signalPrefix = "filed-gstr3b";
    config.targetBoundNativeFilenameNonce = "00000000000040008000000000000001";

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...config,
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.safeFailureSignals).toContain(
      "filed-gstr3b-target-bound-native-blob-click-delegated",
    );
    expect(filenameDuringNativeClick).toBe(
      "GSTR3B_052026_pack-00000000000040008000000000000001.pdf",
    );
    expect(delegatedFilename()).toBe("GSTR3B_000000000000000_052026.pdf");
    expect(failingSetTimeout).toHaveBeenCalledWith(expect.any(Function), 100);
  });

  it("does not overwrite a page-owned filename change during the native handoff", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    const delayedFilenameRestores = interceptWindowTimeout(view, 100);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      { contentType: "application/json" },
    );
    let delegatedAnchor: HTMLAnchorElement | null = null;
    const delegatedFilename = () => delegatedAnchor?.download ?? null;
    view.HTMLAnchorElement.prototype.click = function click() {
      this.download = "page-owned.pdf";
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        delegatedAnchor = anchor;
        anchor.download = "GSTR3B_000000000000000_052026.pdf";
        const blobUrl = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 provisional bytes"], { type: "application/pdf" }),
        );
        xhr.open("GET", "/returns/auth/gstr3b/reopened");
        Object.defineProperty(anchor, "href", { configurable: true, value: blobUrl });
        anchor.click();
      });
      xhr.send();
    });
    const config = captureConfig({ returnType: "GSTR-3B" });
    config.signalPrefix = "filed-gstr3b";
    config.targetBoundNativeFilenameNonce = "00000000000040008000000000000001";

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...config,
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.safeFailureSignals).toContain(
      "filed-gstr3b-target-bound-native-blob-click-delegated",
    );
    expect(delegatedFilename()).toBe("page-owned.pdf");
    expect(delayedFilenameRestores).toHaveLength(1);
    delayedFilenameRestores[0]?.();
    expect(delegatedFilename()).toBe("page-owned.pdf");
  });

  it("lets only the latest action restore a rebound anchor to its root portal filename", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    const delayedFilenameRestores = interceptWindowTimeout(view, 100);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      { contentType: "application/json" },
    );
    view.HTMLAnchorElement.prototype.click = function click() {};
    const anchor = documentRef.createElement("a");
    anchor.download = "GSTR3B_000000000000000_052026.pdf";
    const control = documentRef.querySelector<HTMLButtonElement>("button")!;
    control.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const blobUrl = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 provisional bytes"], { type: "application/pdf" }),
        );
        xhr.open("GET", "/returns/auth/gstr3b/reopened");
        Object.defineProperty(anchor, "href", { configurable: true, value: blobUrl });
        anchor.click();
      });
      xhr.send();
    });
    const firstConfig = captureConfig({ returnType: "GSTR-3B" });
    firstConfig.actionId = "00000000-0000-4000-8000-000000000001";
    firstConfig.signalPrefix = "filed-gstr3b";
    firstConfig.targetBoundNativeFilenameNonce = "00000000000040008000000000000001";

    const firstOutcome = await capturePortalBlobDownloadWithDiagnostics({
      ...firstConfig,
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });
    expect(firstOutcome.safeFailureSignals).toContain(
      "filed-gstr3b-target-bound-native-blob-click-delegated",
    );
    expect(anchor.download).toBe("GSTR3B_052026_pack-00000000000040008000000000000001.pdf");

    control.setAttribute("data-pack-gstr2b-capture-action", "capture-1");
    const secondConfig = captureConfig({ returnType: "GSTR-3B" });
    secondConfig.actionId = "00000000-0000-4000-8000-000000000002";
    secondConfig.signalPrefix = "filed-gstr3b";
    secondConfig.targetBoundNativeFilenameNonce = "00000000000040008000000000000002";
    const secondOutcome = await capturePortalBlobDownloadWithDiagnostics({
      ...secondConfig,
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(secondOutcome.safeFailureSignals).toContain(
      "filed-gstr3b-target-bound-native-blob-click-delegated",
    );
    expect(anchor.download).toBe("GSTR3B_052026_pack-00000000000040008000000000000002.pdf");
    expect(delayedFilenameRestores).toHaveLength(2);
    delayedFilenameRestores[0]?.();
    expect(anchor.download).toBe("GSTR3B_052026_pack-00000000000040008000000000000002.pdf");
    delayedFilenameRestores[1]?.();
    expect(anchor.download).toBe("GSTR3B_000000000000000_052026.pdf");
  });

  it("does not delegate an invalidated GSTR-3B blob with a non-portal filename", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      { contentType: "application/json" },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.download = "synthetic.pdf";
        const blobUrl = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 provisional bytes"], { type: "application/pdf" }),
        );
        xhr.open("GET", "/returns/auth/gstr3b/reopened");
        Object.defineProperty(anchor, "href", { configurable: true, value: blobUrl });
        anchor.click();
      });
      xhr.send();
    });
    const config = captureConfig({ returnType: "GSTR-3B" });
    config.signalPrefix = "filed-gstr3b";
    config.targetBoundNativeFilenameNonce = "00000000000040008000000000000001";

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...config,
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.safeFailureSignals).not.toContain(
      "filed-gstr3b-target-bound-native-blob-click-delegated",
    );
    expect(outcome.targetBoundNativeDelegatedAt).toBeUndefined();
    expect(nativeClicks).toBe(1);
  });

  it("keeps the action filename through native dispatchEvent handoff, then restores it", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    const delayedFilenameRestores = interceptWindowTimeout(view, 100);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      { contentType: "application/json" },
    );
    let delegatedAnchor: HTMLAnchorElement | null = null;
    const delegatedFilename = () => delegatedAnchor?.download ?? null;
    let filenameDuringDispatch: string | null = null;
    let filenameAfterDispatch: string | null = null;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        delegatedAnchor = anchor;
        anchor.download = "GSTR3B_000000000000000_052026.pdf";
        anchor.addEventListener("click", () => {
          filenameDuringDispatch = anchor.download;
        });
        const blobUrl = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 provisional bytes"], { type: "application/pdf" }),
        );
        xhr.open("GET", "/returns/auth/gstr3b/reopened");
        Object.defineProperty(anchor, "href", { configurable: true, value: blobUrl });
        anchor.dispatchEvent(new view.MouseEvent("click", { bubbles: true, cancelable: true }));
        filenameAfterDispatch = anchor.download;
      });
      xhr.send();
    });
    const config = captureConfig({ returnType: "GSTR-3B" });
    config.actionId = "00000000-0000-4000-8000-000000000001";
    config.signalPrefix = "filed-gstr3b";
    config.targetBoundNativeFilenameNonce = "00000000000040008000000000000001";

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...config,
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.safeFailureSignals).toContain(
      "filed-gstr3b-target-bound-native-blob-click-delegated",
    );
    expect(filenameDuringDispatch).toBe("GSTR3B_052026_pack-00000000000040008000000000000001.pdf");
    expect(filenameAfterDispatch).toBe("GSTR3B_052026_pack-00000000000040008000000000000001.pdf");
    expect(delayedFilenameRestores).toHaveLength(1);
    delayedFilenameRestores[0]?.();
    expect(delegatedFilename()).toBe("GSTR3B_000000000000000_052026.pdf");
  });

  it("restores the portal filename immediately after a canceled native dispatch", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    const delayedFilenameRestores = interceptWindowTimeout(view, 100);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      { contentType: "application/json" },
    );
    let delegatedAnchor: HTMLAnchorElement | null = null;
    const delegatedFilename = () => delegatedAnchor?.download ?? null;
    let dispatchResult = true;
    let filenameDuringDispatch: string | null = null;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        delegatedAnchor = anchor;
        anchor.download = "GSTR3B_000000000000000_052026.pdf";
        anchor.addEventListener("click", (event) => {
          filenameDuringDispatch = anchor.download;
          event.preventDefault();
        });
        const blobUrl = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 provisional bytes"], { type: "application/pdf" }),
        );
        xhr.open("GET", "/returns/auth/gstr3b/reopened");
        Object.defineProperty(anchor, "href", { configurable: true, value: blobUrl });
        dispatchResult = anchor.dispatchEvent(
          new view.MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      xhr.send();
    });
    const config = captureConfig({ returnType: "GSTR-3B" });
    config.signalPrefix = "filed-gstr3b";
    config.targetBoundNativeFilenameNonce = "00000000000040008000000000000001";

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...config,
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(dispatchResult).toBe(false);
    expect(outcome.safeFailureSignals).not.toContain(
      "filed-gstr3b-target-bound-native-blob-click-delegated",
    );
    expect(filenameDuringDispatch).toBe("GSTR3B_052026_pack-00000000000040008000000000000001.pdf");
    expect(delegatedFilename()).toBe("GSTR3B_000000000000000_052026.pdf");
    expect(delayedFilenameRestores).toHaveLength(0);
  });

  it("restores the portal filename immediately when native dispatch throws", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    const delayedFilenameRestores = interceptWindowTimeout(view, 100);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      { contentType: "application/json" },
    );
    let delegatedAnchor: HTMLAnchorElement | null = null;
    const delegatedFilename = () => delegatedAnchor?.download ?? null;
    let filenameDuringDispatch: string | null = null;
    let filenameAfterThrow: string | null = null;
    view.HTMLAnchorElement.prototype.dispatchEvent = function dispatchEvent() {
      filenameDuringDispatch = this.download;
      throw new Error("synthetic native dispatch failure");
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        delegatedAnchor = anchor;
        anchor.download = "GSTR3B_000000000000000_052026.pdf";
        const blobUrl = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 provisional bytes"], { type: "application/pdf" }),
        );
        xhr.open("GET", "/returns/auth/gstr3b/reopened");
        Object.defineProperty(anchor, "href", { configurable: true, value: blobUrl });
        try {
          anchor.dispatchEvent(new view.MouseEvent("click", { bubbles: true, cancelable: true }));
        } catch {
          filenameAfterThrow = anchor.download;
        }
      });
      xhr.send();
    });
    const config = captureConfig({ returnType: "GSTR-3B" });
    config.signalPrefix = "filed-gstr3b";
    config.targetBoundNativeFilenameNonce = "00000000000040008000000000000001";

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...config,
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.safeFailureSignals).not.toContain(
      "filed-gstr3b-target-bound-native-blob-click-delegated",
    );
    expect(filenameDuringDispatch).toBe("GSTR3B_052026_pack-00000000000040008000000000000001.pdf");
    expect(filenameAfterThrow).toBe("GSTR3B_000000000000000_052026.pdf");
    expect(delegatedFilename()).toBe("GSTR3B_000000000000000_052026.pdf");
    expect(delayedFilenameRestores).toHaveLength(0);
  });

  it("restores the portal filename immediately when native click delegation throws", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download Filed GSTR-3B</button>
    `);
    const delayedFilenameRestores = interceptWindowTimeout(view, 100);
    configureTestTarget(documentRef, view, {
      path: "/returns/auth/gstr3b",
      returnType: "GSTR-3B",
    });
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      { contentType: "application/json" },
    );
    let delegatedAnchor: HTMLAnchorElement | null = null;
    const delegatedFilename = () => delegatedAnchor?.download ?? null;
    let filenameDuringNativeClick: string | null = null;
    let filenameAfterThrow: string | null = null;
    view.HTMLAnchorElement.prototype.click = function click() {
      filenameDuringNativeClick = this.download;
      throw new Error("synthetic native click failure");
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        delegatedAnchor = anchor;
        anchor.download = "GSTR3B_000000000000000_052026.pdf";
        const blobUrl = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 provisional bytes"], { type: "application/pdf" }),
        );
        xhr.open("GET", "/returns/auth/gstr3b/reopened");
        Object.defineProperty(anchor, "href", { configurable: true, value: blobUrl });
        try {
          anchor.click();
        } catch {
          filenameAfterThrow = anchor.download;
        }
      });
      xhr.send();
    });
    const config = captureConfig({ returnType: "GSTR-3B" });
    config.actionId = "00000000-0000-4000-8000-000000000001";
    config.signalPrefix = "filed-gstr3b";
    config.targetBoundNativeFilenameNonce = "00000000000040008000000000000001";

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...config,
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.safeFailureSignals).not.toContain(
      "filed-gstr3b-target-bound-native-blob-click-delegated",
    );
    expect(filenameDuringNativeClick).toBe(
      "GSTR3B_052026_pack-00000000000040008000000000000001.pdf",
    );
    expect(filenameAfterThrow).toBe("GSTR3B_000000000000000_052026.pdf");
    expect(delegatedFilename()).toBe("GSTR3B_000000000000000_052026.pdf");
    expect(delayedFilenameRestores).toHaveLength(0);
  });

  it("invalidates a provisional PDF when a second action-bound XHR is sent", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      { contentType: "application/json" },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const firstXhr = new view.XMLHttpRequest();
      const anchor = documentRef.createElement("a");
      anchor.download = "ambiguous.pdf";
      let provisionalUrl = "";
      firstXhr.open("GET", "/returns/auth/gstr3b/generated");
      firstXhr.addEventListener("load", () => {
        provisionalUrl = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 ambiguous provisional bytes"], {
            type: "application/pdf",
          }),
        );
      });
      firstXhr.send();

      const secondXhr = new view.XMLHttpRequest();
      secondXhr.open("GET", "/returns/auth/gstr3b/secondary");
      secondXhr.send();
      Object.defineProperty(anchor, "href", { configurable: true, value: provisionalUrl });
      anchor.click();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toContain("gstr2b-xhr-action-binding-ambiguous");
    expect(nativeClicks).toBe(1);
  });

  it("requires an explicit download anchor before committing a provisional PDF", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        Object.defineProperty(anchor, "href", {
          configurable: true,
          value: view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 preview bytes"], { type: "application/pdf" }),
          ),
        });
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(nativeClicks).toBe(1);
  });

  it("does not commit a provisional PDF when the anchor handler cancels its click", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let anchorHandlerCalls = 0;
    let defaultPreventedBefore = true;
    let defaultPreventedAfter = false;
    let returnValueBefore = false;
    let returnValueAfter = true;
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.download = "cancelled.pdf";
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 cancelled bytes"], { type: "application/pdf" }),
        );
        anchor.addEventListener("click", (event) => {
          anchorHandlerCalls += 1;
          anchor.removeAttribute("download");
          defaultPreventedBefore = event.defaultPrevented;
          returnValueBefore = event.returnValue;
          event.preventDefault();
          defaultPreventedAfter = event.defaultPrevented;
          returnValueAfter = event.returnValue;
        });
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(anchorHandlerCalls).toBe(1);
    expect(defaultPreventedBefore).toBe(false);
    expect(defaultPreventedAfter).toBe(true);
    expect(returnValueBefore).toBe(true);
    expect(returnValueAfter).toBe(false);
    expect(nativeClicks).toBe(0);
  });

  it("does not commit a provisional PDF when the anchor onclick handler returns false", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let anchorHandlerCalls = 0;
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.download = "cancelled.pdf";
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 cancelled bytes"], { type: "application/pdf" }),
        );
        anchor.onclick = () => {
          anchorHandlerCalls += 1;
          return false;
        };
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(anchorHandlerCalls).toBe(1);
    expect(nativeClicks).toBe(0);
  });

  it.each(["parent", "document", "window"] as const)(
    "does not commit a provisional PDF when a %s onclick handler returns false",
    async (handlerTargetName) => {
      const { documentRef, view } = installMainWorldDom(`
        <button data-pack-gstr2b-capture-action="capture-1">Download</button>
      `);
      const scheduleUnbound = view.setTimeout.bind(view);
      installFakeXhr(
        view,
        () => new view.Blob(["synthetic response"], { type: "application/json" }),
        {
          contentType: "application/json",
          scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
        },
      );
      let anchorHandlerCalls = 0;
      let nativeClicks = 0;
      view.HTMLAnchorElement.prototype.click = function click() {
        nativeClicks += 1;
      };
      documentRef.querySelector("button")?.addEventListener("click", () => {
        const xhr = new view.XMLHttpRequest();
        xhr.open("GET", "/returns/auth/gstr3b/generated");
        xhr.addEventListener("load", () => {
          const parent = documentRef.createElement("div");
          const anchor = documentRef.createElement("a");
          anchor.download = "cancelled.pdf";
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 cancelled bytes"], { type: "application/pdf" }),
          );
          parent.append(anchor);
          documentRef.body.append(parent);
          const handlerTarget =
            handlerTargetName === "parent"
              ? parent
              : handlerTargetName === "document"
                ? documentRef
                : view;
          handlerTarget.onclick = () => {
            anchorHandlerCalls += 1;
            return false;
          };
          anchor.click();
        });
        xhr.send();
      });

      const outcome = await capturePortalBlobDownloadWithDiagnostics({
        ...captureConfig(),
        asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
        timeoutMs: 25,
      });

      expect(outcome.capturedDownloadRequest).toBeNull();
      expect(anchorHandlerCalls).toBe(1);
      expect(nativeClicks).toBe(0);
    },
  );

  it.each(["document", "window"] as const)(
    "does not commit a provisional PDF when a parent dynamically assigns %s.onclick",
    async (handlerTargetName) => {
      const { documentRef, view } = installMainWorldDom(`
        <button data-pack-gstr2b-capture-action="capture-1">Download</button>
      `);
      const scheduleUnbound = view.setTimeout.bind(view);
      installFakeXhr(
        view,
        () => new view.Blob(["synthetic response"], { type: "application/json" }),
        {
          contentType: "application/json",
          scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
        },
      );
      const handlerTarget = handlerTargetName === "document" ? documentRef : view;
      const originalOwnDescriptor = Object.getOwnPropertyDescriptor(handlerTarget, "onclick");
      let handlerCalls = 0;
      let handlerObservedDefaultPrevented = false;
      const dynamicHandler = (event: MouseEvent) => {
        handlerCalls += 1;
        handlerObservedDefaultPrevented = event.defaultPrevented;
        return false;
      };
      documentRef.querySelector("button")?.addEventListener("click", () => {
        const xhr = new view.XMLHttpRequest();
        xhr.open("GET", "/returns/auth/gstr3b/generated");
        xhr.addEventListener("load", () => {
          const parent = documentRef.createElement("div");
          const anchor = documentRef.createElement("a");
          anchor.download = "dynamic-onclick.pdf";
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 dynamic onclick bytes"], { type: "application/pdf" }),
          );
          parent.append(anchor);
          documentRef.body.append(parent);
          parent.addEventListener(
            "click",
            () => {
              handlerTarget.onclick = dynamicHandler;
            },
            { once: true },
          );
          anchor.click();
        });
        xhr.send();
      });

      const outcome = await capturePortalBlobDownloadWithDiagnostics({
        ...captureConfig(),
        asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
        timeoutMs: 25,
      });

      expect(outcome.capturedDownloadRequest).toBeNull();
      expect(handlerCalls).toBe(1);
      expect(handlerObservedDefaultPrevented).toBe(false);
      expect(handlerTarget.onclick).toBe(dynamicHandler);
      expect(Object.getOwnPropertyDescriptor(handlerTarget, "onclick")).toEqual(
        originalOwnDescriptor,
      );
    },
  );

  it("runs a dynamically assigned window onclick from the window capture phase", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let handlerCalls = 0;
    const dynamicHandler = () => {
      handlerCalls += 1;
      return false;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.download = "window-capture-onclick.pdf";
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 window capture onclick bytes"], {
            type: "application/pdf",
          }),
        );
        documentRef.body.append(anchor);
        view.addEventListener(
          "click",
          () => {
            view.onclick = dynamicHandler;
          },
          { capture: true, once: true },
        );
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(handlerCalls).toBe(1);
    expect(view.onclick).toBe(dynamicHandler);
  });

  it("does not run an onclick first assigned during the anchor target phase", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let anchor!: HTMLAnchorElement;
    let lateHandlerCalls = 0;
    const lateHandler = () => {
      lateHandlerCalls += 1;
      return false;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        anchor = documentRef.createElement("a");
        anchor.download = "late-anchor-onclick.pdf";
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 late anchor onclick bytes"], { type: "application/pdf" }),
        );
        documentRef.body.append(anchor);
        anchor.addEventListener(
          "click",
          () => {
            anchor!.onclick = lateHandler;
          },
          { once: true },
        );
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 50,
    });

    expect(outcome.capturedDownloadRequest).not.toBeNull();
    expect(lateHandlerCalls).toBe(0);
    expect(anchor.onclick).toBe(lateHandler);
    const replayResult = anchor.dispatchEvent(
      new view.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(replayResult).toBe(false);
    expect(lateHandlerCalls).toBe(1);
  });

  it.each([
    ["anchor", "stopPropagation"],
    ["anchor", "stopImmediatePropagation"],
    ["window-capture", "stopPropagation"],
  ] as const)(
    "fails closed when a saved native %s handler calls %s",
    async (handlerTargetName, stopMethod) => {
      const { documentRef, view } = installMainWorldDom(`
        <button data-pack-gstr2b-capture-action="capture-1">Download</button>
      `);
      const scheduleUnbound = view.setTimeout.bind(view);
      installFakeXhr(
        view,
        () => new view.Blob(["synthetic response"], { type: "application/json" }),
        {
          contentType: "application/json",
          scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
        },
      );
      const savedStop =
        stopMethod === "stopPropagation"
          ? view.Event.prototype.stopPropagation
          : view.Event.prototype.stopImmediatePropagation;
      let handlerCalls = 0;
      documentRef.querySelector("button")?.addEventListener("click", () => {
        const xhr = new view.XMLHttpRequest();
        xhr.open("GET", "/returns/auth/gstr3b/generated");
        xhr.addEventListener("load", () => {
          const anchor = documentRef.createElement("a");
          anchor.download = "saved-native-stop.pdf";
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 saved native stop bytes"], { type: "application/pdf" }),
          );
          documentRef.body.append(anchor);
          const stopHandler = (event: Event) => {
            handlerCalls += 1;
            savedStop.call(event);
          };
          if (handlerTargetName === "anchor") {
            anchor.addEventListener("click", stopHandler);
          } else {
            view.addEventListener("click", stopHandler, { capture: true, once: true });
          }
          anchor.click();
        });
        xhr.send();
      });

      const outcome = await capturePortalBlobDownloadWithDiagnostics({
        ...captureConfig(),
        asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
        timeoutMs: 25,
      });

      expect(outcome.capturedDownloadRequest).toBeNull();
      expect(handlerCalls).toBe(1);
    },
  );

  it("does not commit when a slotted onclick handler returns false", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let slotHandlerCalls = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const host = documentRef.createElement("div");
        const shadow = host.attachShadow({ mode: "open" });
        const slot = documentRef.createElement("slot");
        const anchor = documentRef.createElement("a");
        anchor.download = "slotted-onclick.pdf";
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 slotted onclick bytes"], { type: "application/pdf" }),
        );
        slot.onclick = () => {
          slotHandlerCalls += 1;
          return false;
        };
        shadow.append(slot);
        host.append(anchor);
        documentRef.body.append(host);
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(slotHandlerCalls).toBe(1);
  });

  it("does not commit when a page handler sets returnValue to false", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let defaultPreventedBefore = true;
    let defaultPreventedAfter = false;
    let returnValueBefore = false;
    let returnValueAfter = true;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.download = "return-value.pdf";
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 return value bytes"], { type: "application/pdf" }),
        );
        anchor.addEventListener("click", (event) => {
          defaultPreventedBefore = event.defaultPrevented;
          returnValueBefore = event.returnValue;
          event.returnValue = false;
          defaultPreventedAfter = event.defaultPrevented;
          returnValueAfter = event.returnValue;
        });
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(defaultPreventedBefore).toBe(false);
    expect(defaultPreventedAfter).toBe(true);
    expect(returnValueBefore).toBe(true);
    expect(returnValueAfter).toBe(false);
  });

  it("preserves page-owned visibility descriptors installed on a suppressed event", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    const pageDefaultPreventedGetter = () => false;
    const pageReturnValueGetter = () => true;
    const pageReturnValueSetter = () => undefined;
    let dispatchedEvent!: MouseEvent;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.download = "page-event-descriptor.pdf";
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 page event descriptor bytes"], {
            type: "application/pdf",
          }),
        );
        anchor.addEventListener("click", (event) => {
          Object.defineProperty(event, "defaultPrevented", {
            configurable: true,
            get: pageDefaultPreventedGetter,
          });
          Object.defineProperty(event, "returnValue", {
            configurable: true,
            get: pageReturnValueGetter,
            set: pageReturnValueSetter,
          });
        });
        dispatchedEvent = new view.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        anchor.dispatchEvent(dispatchedEvent);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 50,
    });

    expect(outcome.capturedDownloadRequest).not.toBeNull();
    expect(Object.getOwnPropertyDescriptor(dispatchedEvent, "defaultPrevented")).toMatchObject({
      get: pageDefaultPreventedGetter,
    });
    expect(Object.getOwnPropertyDescriptor(dispatchedEvent, "returnValue")).toMatchObject({
      get: pageReturnValueGetter,
      set: pageReturnValueSetter,
    });
  });

  it.each(["parent", "document"] as const)(
    "fails closed when a %s click handler stops bubbling through cancelBubble",
    async (handlerTargetName) => {
      const { documentRef, view } = installMainWorldDom(`
        <button data-pack-gstr2b-capture-action="capture-1">Download</button>
      `);
      const scheduleUnbound = view.setTimeout.bind(view);
      installFakeXhr(
        view,
        () => new view.Blob(["synthetic response"], { type: "application/json" }),
        {
          contentType: "application/json",
          scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
        },
      );
      let handlerCalls = 0;
      documentRef.querySelector("button")?.addEventListener("click", () => {
        const xhr = new view.XMLHttpRequest();
        xhr.open("GET", "/returns/auth/gstr3b/generated");
        xhr.addEventListener("load", () => {
          const parent = documentRef.createElement("div");
          const anchor = documentRef.createElement("a");
          anchor.download = "stopped.pdf";
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 stopped bytes"], { type: "application/pdf" }),
          );
          parent.append(anchor);
          documentRef.body.append(parent);
          const handlerTarget = handlerTargetName === "parent" ? parent : documentRef;
          handlerTarget.onclick = (event) => {
            handlerCalls += 1;
            event.cancelBubble = true;
          };
          anchor.click();
        });
        xhr.send();
      });

      const outcome = await capturePortalBlobDownloadWithDiagnostics({
        ...captureConfig(),
        asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
        timeoutMs: 25,
      });

      expect(outcome.capturedDownloadRequest).toBeNull();
      expect(handlerCalls).toBe(1);
    },
  );

  it.each(["non-cancelable", "pre-stopped"] as const)(
    "rejects a %s supplied click event before dispatching a provisional PDF sink",
    async (eventKind) => {
      const { documentRef, view } = installMainWorldDom(`
        <button data-pack-gstr2b-capture-action="capture-1">Download</button>
      `);
      const scheduleUnbound = view.setTimeout.bind(view);
      installFakeXhr(
        view,
        () => new view.Blob(["synthetic response"], { type: "application/json" }),
        {
          contentType: "application/json",
          scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
        },
      );
      let anchorHandlerCalls = 0;
      let dispatchResult = true;
      documentRef.querySelector("button")?.addEventListener("click", () => {
        const xhr = new view.XMLHttpRequest();
        xhr.open("GET", "/returns/auth/gstr3b/generated");
        xhr.addEventListener("load", () => {
          const anchor = documentRef.createElement("a");
          anchor.download = "rejected-event.pdf";
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 rejected event bytes"], { type: "application/pdf" }),
          );
          anchor.addEventListener("click", () => {
            anchorHandlerCalls += 1;
          });
          const clickEvent = new view.MouseEvent("click", {
            bubbles: true,
            cancelable: eventKind !== "non-cancelable",
          });
          if (eventKind === "pre-stopped") clickEvent.cancelBubble = true;
          dispatchResult = anchor.dispatchEvent(clickEvent);
        });
        xhr.send();
      });

      const outcome = await capturePortalBlobDownloadWithDiagnostics({
        ...captureConfig(),
        asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
        timeoutMs: 25,
      });

      expect(outcome.capturedDownloadRequest).toBeNull();
      expect(dispatchResult).toBe(false);
      expect(anchorHandlerCalls).toBe(0);
    },
  );

  it("captures a provisional PDF through a non-bubbling download-anchor event", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let dispatchResult = false;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.download = "non-bubbling.pdf";
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 non-bubbling bytes"], { type: "application/pdf" }),
        );
        dispatchResult = anchor.dispatchEvent(
          new view.MouseEvent("click", { bubbles: false, cancelable: true }),
        );
      });
      xhr.send();
    });

    const captured = await capturePortalBlobDownload({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 50,
    });

    expect(dispatchResult).toBe(true);
    expect(captured?.dataUrl).toContain("data:application/pdf;base64,");
  });

  it("dispatches a synthesized download click across a connected shadow boundary", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let hostHandlerCalls = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const host = documentRef.createElement("div");
        const shadow = host.attachShadow({ mode: "open" });
        const anchor = documentRef.createElement("a");
        anchor.download = "shadow.pdf";
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 shadow bytes"], { type: "application/pdf" }),
        );
        shadow.append(anchor);
        documentRef.body.append(host);
        host.onclick = () => {
          hostHandlerCalls += 1;
          return false;
        };
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(hostHandlerCalls).toBe(1);
  });

  it("removes the terminal click suppressor when anchor dispatch throws", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    const originalWindowAddEventListener = view.addEventListener.bind(view);
    const originalWindowRemoveEventListener = view.removeEventListener.bind(view);
    const terminalClickListeners = new Set<EventListenerOrEventListenerObject>();
    view.addEventListener = function addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "click" && listener && typeof options === "object" && options.once === true) {
        terminalClickListeners.add(listener);
      }
      if (listener) originalWindowAddEventListener(type, listener, options);
    } as typeof view.addEventListener;
    view.removeEventListener = function removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      if (type === "click" && listener) terminalClickListeners.delete(listener);
      if (listener) originalWindowRemoveEventListener(type, listener, options);
    } as typeof view.removeEventListener;
    view.HTMLAnchorElement.prototype.dispatchEvent = function dispatchEvent() {
      throw new Error("synthetic dispatch failure");
    };
    let dispatchThrew = false;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.download = "throwing.pdf";
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 throwing bytes"], { type: "application/pdf" }),
        );
        documentRef.body.append(anchor);
        try {
          anchor.click();
        } catch {
          dispatchThrew = true;
        }
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(dispatchThrew).toBe(true);
    expect(terminalClickListeners).toHaveLength(0);
  });

  it("does not commit a provisional PDF after the anchor handler retargets its href", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let anchorHandlerCalls = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.download = "retargeted.pdf";
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 retargeted bytes"], { type: "application/pdf" }),
        );
        anchor.addEventListener("click", () => {
          anchorHandlerCalls += 1;
          Object.defineProperty(anchor, "href", {
            configurable: true,
            value: "blob:https://gstr2b.gst.gov.in/retargeted",
          });
        });
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(anchorHandlerCalls).toBe(1);
  });

  it("does not commit a provisional PDF through window.open", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeOpens = 0;
    view.open = vi.fn(() => {
      nativeOpens += 1;
      return null;
    });
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const blobUrl = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 preview-window bytes"], { type: "application/pdf" }),
        );
        view.open(blobUrl);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(nativeOpens).toBe(1);
  });

  it("does not commit a provisional PDF from a delayed anchor sink", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      const anchor = documentRef.createElement("a");
      anchor.download = "delayed.pdf";
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        Object.defineProperty(anchor, "href", {
          configurable: true,
          value: view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 delayed-sink bytes"], { type: "application/pdf" }),
          ),
        });
        scheduleUnbound(() => anchor.click(), 0);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(nativeClicks).toBe(1);
  });

  it("does not rearm the grant for a repeated trusted terminal event", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => {
          scheduleUnbound(dispatch, 0);
          scheduleUnbound(dispatch, 5);
        },
      },
    );
    let calls = 0;
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        calls += 1;
        if (calls !== 2) return;
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 repeated-event bytes"], { type: "application/pdf" }),
        );
        anchor.download = "repeated.pdf";
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(calls).toBe(2);
    expect(nativeClicks).toBe(1);
  });

  it("does not propagate a provisional PDF through a second Promise continuation", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      const anchor = documentRef.createElement("a");
      anchor.download = "nested.pdf";
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        void view.Promise.resolve().then(() => {
          Object.defineProperty(anchor, "href", {
            configurable: true,
            value: view.URL.createObjectURL(
              new view.Blob(["%PDF-1.7 nested bytes"], { type: "application/pdf" }),
            ),
          });
          void view.Promise.resolve().then(() => anchor.click());
        });
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(nativeClicks).toBe(1);
  });

  it("does not bypass the continuation budget through an empty Promise reaction", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      const anchor = documentRef.createElement("a");
      anchor.download = "empty-hop.pdf";
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        void view.Promise.resolve()
          .then()
          .then(() => {
            Object.defineProperty(anchor, "href", {
              configurable: true,
              value: view.URL.createObjectURL(
                new view.Blob(["%PDF-1.7 empty-hop bytes"], { type: "application/pdf" }),
              ),
            });
            anchor.click();
          });
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(nativeClicks).toBe(1);
  });

  it("restores an active page listener after a capture timeout", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      { contentType: "application/json", scheduleLoad: () => undefined },
    );
    let calls = 0;
    let xhr: XMLHttpRequest | null = null;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        calls += 1;
      });
      xhr.send();
    });

    await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 5,
    });
    (xhr as XMLHttpRequest | null)?.dispatchEvent(new view.Event("load"));

    expect(calls).toBe(1);
  });

  it("classifies an unbound Blob while the selected XHR has no callback context", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 15),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.send();
      scheduleUnbound(() => {
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 no-context bytes"], { type: "application/pdf" }),
        );
        anchor.download = "no-context.pdf";
        anchor.click();
      }, 1);
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 30,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-unbound-create-object-url-selection-open-no-context",
        "gstr2b-xhr-selection-closed-without-context",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it("classifies an unbound Blob while the selected XHR context is valid but inactive", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    const queueUnboundMicrotask = view.queueMicrotask.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        queueUnboundMicrotask(() => {
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 valid-inactive bytes"], {
              type: "application/pdf",
            }),
          );
          anchor.download = "valid-inactive.pdf";
          anchor.click();
        });
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-xhr-page-callback-bound-load",
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-unbound-create-object-url-selection-open-valid-inactive-context",
        "gstr2b-xhr-selection-closed-with-context",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it("classifies an unbound Blob while the selected XHR context is invalid", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        view.setTimeout(() => undefined, 0);
        view.setTimeout(() => undefined, 0);
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 invalid-context bytes"], { type: "application/pdf" }),
        );
        anchor.download = "invalid-context.pdf";
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 25,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-xhr-page-callback-bound-load",
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-unbound-create-object-url-selection-open-invalid-context",
        "gstr2b-xhr-selection-closed-with-context",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it("does not claim a PDF created outside the action-bound XHR handler", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => {
          scheduleUnbound(dispatch, 0);
        },
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.send();
    });
    scheduleUnbound(() => {
      const anchor = documentRef.createElement("a");
      anchor.href = view.URL.createObjectURL(
        new view.Blob(["%PDF-1.7 unrelated bytes"], { type: "application/pdf" }),
      );
      anchor.download = "unrelated.pdf";
      anchor.click();
    }, 5);

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome).toMatchObject({
      capturedDownloadRequest: null,
      safeFailureSignals: expect.arrayContaining([
        "gstr2b-xhr-content-type-rejected",
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    });
    expect(nativeClicks).toBe(1);
  });

  it("captures the exact PDF through one bounded timer from the action-bound XHR handler", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        view.setTimeout(() => {
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 timer bytes"], { type: "application/pdf" }),
          );
          anchor.download = "timer.pdf";
          anchor.click();
        }, 0);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.capturedDownloadRequest).toMatchObject({
      actionId: "action-1",
      safeSignals: expect.arrayContaining([
        "gstr2b-portal-blob-captured",
        "gstr2b-native-blob-click-suppressed",
        "gstr2b-main-world-capture",
      ]),
    });
    expect(outcome.capturedDownloadRequest?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeClicks).toBe(0);
  });

  it("preserves the native timer receiver at the 1000 ms XHR continuation bound after loadend", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    const delayedTimers = interceptWindowTimeout(view, 1_000);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    const timerContinuation = vi.fn(function timerContinuation(this: unknown) {
      const anchor = documentRef.createElement("a");
      anchor.href = view.URL.createObjectURL(
        new view.Blob(["%PDF-1.7 max-timer bytes"], { type: "application/pdf" }),
      );
      anchor.download = "max-timer.pdf";
      anchor.click();
    });
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        view.setTimeout(timerContinuation, 1_000);
      });
      xhr.send();
    });

    const capture = capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 250,
    });
    await vi.waitFor(() => expect(delayedTimers).toHaveLength(2), {
      interval: 1,
      timeout: 100,
    });
    delayedTimers[0]?.();
    await vi.waitFor(() => expect(delayedTimers.length).toBeGreaterThanOrEqual(3), {
      interval: 1,
      timeout: 100,
    });
    for (const delayedTimer of delayedTimers.slice(1)) delayedTimer();
    const outcome = await capture;

    expect(timerContinuation).toHaveBeenCalledTimes(1);
    expect(timerContinuation.mock.contexts).toEqual([view]);
    expect(outcome.capturedDownloadRequest).toMatchObject({ actionId: "action-1" });
    expect(outcome.capturedDownloadRequest?.dataUrl).toContain("data:application/pdf;base64,");
    expect(nativeClicks).toBe(0);
  });

  it("invalidates the XHR PDF grant when its handler schedules a second timer", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        view.setTimeout(() => {
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 first-timer bytes"], { type: "application/pdf" }),
          );
          anchor.download = "first-timer.pdf";
          anchor.click();
        }, 0);
        view.setTimeout(() => undefined, 0);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it("does not propagate the XHR PDF grant through a nested timer", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        view.setTimeout(() => {
          view.setTimeout(() => {
            const anchor = documentRef.createElement("a");
            anchor.href = view.URL.createObjectURL(
              new view.Blob(["%PDF-1.7 nested-timer bytes"], { type: "application/pdf" }),
            );
            anchor.download = "nested-timer.pdf";
            anchor.click();
          }, 0);
        }, 0);
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it("does not propagate the XHR PDF grant through a timer beyond the bounded delay", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    const delayedTimers = interceptWindowTimeout(view, 1_001);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        view.setTimeout(() => {
          const anchor = documentRef.createElement("a");
          anchor.href = view.URL.createObjectURL(
            new view.Blob(["%PDF-1.7 overlong-timer bytes"], { type: "application/pdf" }),
          );
          anchor.download = "overlong-timer.pdf";
          anchor.click();
        }, 1_001);
      });
      xhr.send();
    });

    const capture = capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 30,
    });
    await new Promise<void>((resolve) => scheduleUnbound(resolve, 5));
    expect(delayedTimers).toHaveLength(1);
    delayedTimers[0]?.();
    const outcome = await capture;

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it.each(["abort", "error", "timeout"] as const)(
    "invalidates a reserved XHR timer continuation after terminal %s",
    async (terminalEvent) => {
      const { documentRef, view } = installMainWorldDom(`
        <button data-pack-gstr2b-capture-action="capture-1">Download</button>
      `);
      const scheduleUnbound = view.setTimeout.bind(view);
      const delayedTimers = interceptWindowTimeout(view, 10);
      installFakeXhr(
        view,
        () => new view.Blob(["synthetic response"], { type: "application/json" }),
        {
          contentType: "application/json",
          scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
          terminalEvent,
        },
      );
      let nativeClicks = 0;
      view.HTMLAnchorElement.prototype.click = function click() {
        nativeClicks += 1;
      };
      documentRef.querySelector("button")?.addEventListener("click", () => {
        const xhr = new view.XMLHttpRequest();
        xhr.open("GET", "/returns/auth/gstr3b/generated");
        xhr.addEventListener("readystatechange", () => {
          if (xhr.readyState !== 4) return;
          view.setTimeout(() => {
            const anchor = documentRef.createElement("a");
            anchor.href = view.URL.createObjectURL(
              new view.Blob(["%PDF-1.7 terminal-timer bytes"], {
                type: "application/pdf",
              }),
            );
            anchor.download = "terminal-timer.pdf";
            anchor.click();
          }, 10);
        });
        xhr.send();
      });

      const capture = capturePortalBlobDownloadWithDiagnostics({
        ...captureConfig(),
        asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
        timeoutMs: 25,
      });
      await new Promise<void>((resolve) => scheduleUnbound(resolve, 5));
      expect(delayedTimers).toHaveLength(1);
      delayedTimers[0]?.();
      const outcome = await capture;

      expect(outcome.capturedDownloadRequest).toBeNull();
      expect(outcome.safeFailureSignals).toEqual(
        expect.arrayContaining([
          "gstr2b-unbound-create-object-url-ignored",
          "gstr2b-main-world-capture-timeout",
        ]),
      );
      expect(nativeClicks).toBe(1);
    },
  );

  it("invalidates the grant when the same XHR is reopened outside the action", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 10),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 reopened bytes"], { type: "application/pdf" }),
        );
        anchor.download = "reopened.pdf";
        anchor.click();
      });
      xhr.send();
      scheduleUnbound(() => {
        xhr.open("GET", "/returns/auth/gstr3b/reopened");
        xhr.send();
      }, 0);
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 30,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBeGreaterThan(0);
  });

  it("does not grant async binding to a synchronous XHR declaration", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated", false);
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 sync-declared bytes"], { type: "application/pdf" }),
        );
        anchor.download = "sync.pdf";
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it.each([
    { contentType: "application/json", eventType: "load", name: "non-2xx", status: 500 },
    { contentType: null, eventType: "load", name: "missing content type", status: 200 },
    { contentType: "application/json", eventType: "error", name: "error", status: 0 },
    { contentType: "application/json", eventType: "abort", name: "abort", status: 0 },
    { contentType: "application/json", eventType: "timeout", name: "timeout", status: 0 },
  ] as const)("does not grant async binding after $name completion", async (scenario) => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: scenario.contentType,
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
        status: scenario.status,
        terminalEvent: scenario.eventType,
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener(scenario.eventType, () => {
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 rejected terminal bytes"], { type: "application/pdf" }),
        );
        anchor.download = "rejected.pdf";
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it("consumes the XHR grant on the first Blob attempt even when it is not a PDF", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => scheduleUnbound(dispatch, 0),
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        view.URL.createObjectURL(new view.Blob(["first attempt"], { type: "text/plain" }));
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 second attempt"], { type: "application/pdf" }),
        );
        anchor.download = "second.pdf";
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it("disables async PDF binding when more than one XHR is sent by the action", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => {
          scheduleUnbound(dispatch, 0);
        },
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const artifactXhr = new view.XMLHttpRequest();
      artifactXhr.open("GET", "/returns/auth/gstr3b/generated");
      artifactXhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["%PDF-1.7 ambiguous bytes"], { type: "application/pdf" }),
        );
        anchor.download = "period.pdf";
        anchor.click();
      });
      artifactXhr.send();

      const secondXhr = new view.XMLHttpRequest();
      secondXhr.open("GET", "/returns/auth/gstr3b/secondary");
      secondXhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-xhr-action-binding-ambiguous",
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
  });

  it("rejects a non-PDF Blob produced by the verified action's XHR", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const scheduleUnbound = view.setTimeout.bind(view);
    installFakeXhr(
      view,
      () => new view.Blob(["synthetic response"], { type: "application/json" }),
      {
        contentType: "application/json",
        scheduleLoad: (dispatch) => {
          scheduleUnbound(dispatch, 0);
        },
      },
    );
    let nativeClicks = 0;
    view.HTMLAnchorElement.prototype.click = function click() {
      nativeClicks += 1;
    };
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const xhr = new view.XMLHttpRequest();
      xhr.open("GET", "/returns/auth/gstr3b/generated");
      xhr.addEventListener("load", () => {
        const anchor = documentRef.createElement("a");
        anchor.href = view.URL.createObjectURL(
          new view.Blob(["not a PDF"], { type: "text/plain" }),
        );
        anchor.download = "period.txt";
        anchor.click();
      });
      xhr.send();
    });

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 20,
    });

    expect(outcome.capturedDownloadRequest).toBeNull();
    expect(outcome.safeFailureSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-unbound-create-object-url-ignored",
        "gstr2b-main-world-capture-timeout",
      ]),
    );
    expect(nativeClicks).toBe(1);
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

  it("restores setTimeout and does not click when the window.open hook install throws", async () => {
    const { documentRef, view } = installMainWorldDom(
      '<button data-pack-gstr2b-capture-action="capture-1">Download</button>',
    );
    const control = documentRef.querySelector<HTMLButtonElement>("button")!;
    const originalSetTimeoutDescriptor = Object.getOwnPropertyDescriptor(view, "setTimeout");
    const originalWindowOpen = view.open;
    const originalWindowOpenDescriptor = Object.getOwnPropertyDescriptor(view, "open");
    const throwingWindowOpenSetter = vi.fn(() => {
      throw new Error("synthetic window.open install failure");
    });
    Object.defineProperty(view, "open", {
      configurable: true,
      enumerable: originalWindowOpenDescriptor?.enumerable ?? true,
      get: () => originalWindowOpen,
      set: throwingWindowOpenSetter,
    });
    const hostileWindowOpenDescriptor = Object.getOwnPropertyDescriptor(view, "open");
    const controlClick = vi.fn();
    control.addEventListener("click", controlClick);

    const outcome = await capturePortalBlobDownloadWithDiagnostics(captureConfig());

    expect(outcome).toEqual({
      capturedDownloadRequest: null,
      safeFailureSignals: ["gstr2b-main-world-capture-armed", "gstr2b-capture-hook-install-failed"],
    });
    expect(throwingWindowOpenSetter).toHaveBeenCalledOnce();
    expect(controlClick).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(view, "setTimeout")).toEqual(
      originalSetTimeoutDescriptor,
    );
    expect(Object.getOwnPropertyDescriptor(view, "open")).toEqual(hostileWindowOpenDescriptor);
    expect(control.hasAttribute("data-pack-gstr2b-capture-action")).toBe(false);
  });

  it("restores every earlier hook and does not click when anchor dispatch install throws", async () => {
    const { documentRef, view } = installMainWorldDom(
      '<button data-pack-gstr2b-capture-action="capture-1">Download</button>',
    );
    const control = documentRef.querySelector<HTMLButtonElement>("button")!;
    const anchorPrototype = view.HTMLAnchorElement.prototype;
    const xhrPrototype = view.XMLHttpRequest.prototype;
    const earlierHooks: Array<{
      descriptor: PropertyDescriptor | undefined;
      label: string;
      property: PropertyKey;
      target: object;
    }> = [
      { label: "window.setTimeout", property: "setTimeout", target: view },
      { label: "window.open", property: "open", target: view },
      { label: "window.saveAs", property: "saveAs", target: view },
      { label: "window.fetch", property: "fetch", target: view },
      { label: "URL.createObjectURL", property: "createObjectURL", target: view.URL },
      { label: "URL.revokeObjectURL", property: "revokeObjectURL", target: view.URL },
      { label: "XHR.open", property: "open", target: xhrPrototype },
      { label: "XHR.send", property: "send", target: xhrPrototype },
      { label: "XHR.addEventListener", property: "addEventListener", target: xhrPrototype },
      { label: "XHR.removeEventListener", property: "removeEventListener", target: xhrPrototype },
      { label: "XHR.onload", property: "onload", target: xhrPrototype },
      { label: "XHR.onloadend", property: "onloadend", target: xhrPrototype },
      {
        label: "XHR.onreadystatechange",
        property: "onreadystatechange",
        target: xhrPrototype,
      },
      { label: "anchor.click", property: "click", target: anchorPrototype },
    ].map((hook) => ({
      ...hook,
      descriptor: Object.getOwnPropertyDescriptor(hook.target, hook.property),
    }));
    const originalAnchorDispatch = anchorPrototype.dispatchEvent;
    const originalAnchorDispatchDescriptor = Object.getOwnPropertyDescriptor(
      anchorPrototype,
      "dispatchEvent",
    );
    const throwingAnchorDispatchSetter = vi.fn(() => {
      throw new Error("synthetic anchor dispatch install failure");
    });
    Object.defineProperty(anchorPrototype, "dispatchEvent", {
      configurable: true,
      enumerable: originalAnchorDispatchDescriptor?.enumerable ?? false,
      get: () => originalAnchorDispatch,
      set: throwingAnchorDispatchSetter,
    });
    const hostileAnchorDispatchDescriptor = Object.getOwnPropertyDescriptor(
      anchorPrototype,
      "dispatchEvent",
    );
    const controlClick = vi.fn();
    control.addEventListener("click", controlClick);

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
    });

    expect(outcome).toEqual({
      capturedDownloadRequest: null,
      safeFailureSignals: ["gstr2b-main-world-capture-armed", "gstr2b-capture-hook-install-failed"],
    });
    expect(throwingAnchorDispatchSetter).toHaveBeenCalledOnce();
    expect(controlClick).not.toHaveBeenCalled();
    for (const { descriptor, label, property, target } of earlierHooks) {
      expect(Object.getOwnPropertyDescriptor(target, property), label).toEqual(descriptor);
    }
    expect(Object.getOwnPropertyDescriptor(anchorPrototype, "dispatchEvent")).toEqual(
      hostileAnchorDispatchDescriptor,
    );
    expect(control.hasAttribute("data-pack-gstr2b-capture-action")).toBe(false);
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
    const originalXhrAddEventListener = view.XMLHttpRequest.prototype.addEventListener;
    const originalXhrRemoveEventListener = view.XMLHttpRequest.prototype.removeEventListener;
    const originalXhrAddEventListenerOwnDescriptor = Object.getOwnPropertyDescriptor(
      view.XMLHttpRequest.prototype,
      "addEventListener",
    );
    const originalXhrRemoveEventListenerOwnDescriptor = Object.getOwnPropertyDescriptor(
      view.XMLHttpRequest.prototype,
      "removeEventListener",
    );
    const control = documentRef.querySelector<HTMLButtonElement>("button")!;
    control.click = () => {
      throw new Error("synthetic portal click failure");
    };

    const outcome = await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
    });

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
    expect(view.XMLHttpRequest.prototype.addEventListener).toBe(originalXhrAddEventListener);
    expect(view.XMLHttpRequest.prototype.removeEventListener).toBe(originalXhrRemoveEventListener);
    expect(
      Object.getOwnPropertyDescriptor(view.XMLHttpRequest.prototype, "addEventListener"),
    ).toEqual(originalXhrAddEventListenerOwnDescriptor);
    expect(
      Object.getOwnPropertyDescriptor(view.XMLHttpRequest.prototype, "removeEventListener"),
    ).toEqual(originalXhrRemoveEventListenerOwnDescriptor);
    expect(control.hasAttribute("data-pack-gstr2b-capture-action")).toBe(false);
  });

  it.each(["open", "send", "addEventListener", "removeEventListener"] as const)(
    "preserves a page value replacement of XMLHttpRequest.prototype.%s",
    async (property) => {
      const { documentRef, view } = installMainWorldDom(`
        <button data-pack-gstr2b-capture-action="capture-1">Download</button>
      `);
      const replacement = vi.fn();
      documentRef.querySelector("button")?.addEventListener("click", () => {
        Reflect.set(view.XMLHttpRequest.prototype, property, replacement);
      });

      await capturePortalBlobDownloadWithDiagnostics({
        ...captureConfig(),
        asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
        timeoutMs: 5,
      });

      expect(Reflect.get(view.XMLHttpRequest.prototype, property)).toBe(replacement);
    },
  );

  it.each(["open", "send", "addEventListener", "removeEventListener"] as const)(
    "preserves a page descriptor replacement of XMLHttpRequest.prototype.%s",
    async (property) => {
      const { documentRef, view } = installMainWorldDom(`
        <button data-pack-gstr2b-capture-action="capture-1">Download</button>
      `);
      const replacement = vi.fn();
      documentRef.querySelector("button")?.addEventListener("click", () => {
        Object.defineProperty(view.XMLHttpRequest.prototype, property, {
          configurable: true,
          enumerable: true,
          value: replacement,
          writable: false,
        });
      });

      await capturePortalBlobDownloadWithDiagnostics({
        ...captureConfig(),
        asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
        timeoutMs: 5,
      });

      expect(Object.getOwnPropertyDescriptor(view.XMLHttpRequest.prototype, property)).toEqual({
        configurable: true,
        enumerable: true,
        value: replacement,
        writable: false,
      });
    },
  );

  it.each([
    "url-create",
    "url-revoke",
    "webkit-url-create",
    "webkit-url-revoke",
    "fetch",
    "window-open",
    "window-timeout",
    "save-as",
    "anchor-click",
    "anchor-dispatch",
    "pdfmake-create",
  ] as const)("preserves a page replacement of the %s hook", async (hook) => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    if (hook === "url-revoke") {
      Object.defineProperty(view.URL, "revokeObjectURL", {
        configurable: true,
        value: vi.fn(),
        writable: true,
      });
    }
    const webkitUrl = {
      createObjectURL: vi.fn(),
      revokeObjectURL: vi.fn(),
    };
    if (hook === "webkit-url-create" || hook === "webkit-url-revoke") {
      Object.defineProperty(view, "webkitURL", {
        configurable: true,
        value: webkitUrl,
        writable: true,
      });
    }
    const pdfMake = { createPdf: vi.fn() };
    if (hook === "pdfmake-create") {
      Object.defineProperty(view, "pdfMake", {
        configurable: true,
        value: pdfMake,
        writable: true,
      });
    }
    const replacement = vi.fn();
    const hookTarget = (() => {
      switch (hook) {
        case "url-create":
          return { property: "createObjectURL", target: view.URL };
        case "url-revoke":
          return { property: "revokeObjectURL", target: view.URL };
        case "webkit-url-create":
          return { property: "createObjectURL", target: webkitUrl };
        case "webkit-url-revoke":
          return { property: "revokeObjectURL", target: webkitUrl };
        case "fetch":
          return { property: "fetch", target: view };
        case "window-open":
          return { property: "open", target: view };
        case "window-timeout":
          return { property: "setTimeout", target: view };
        case "save-as":
          return { property: "saveAs", target: view };
        case "anchor-click":
          return { property: "click", target: view.HTMLAnchorElement.prototype };
        case "anchor-dispatch":
          return { property: "dispatchEvent", target: view.HTMLAnchorElement.prototype };
        case "pdfmake-create":
          return { property: "createPdf", target: pdfMake };
      }
    })();
    documentRef.querySelector("button")?.addEventListener("click", () => {
      Object.defineProperty(hookTarget.target, hookTarget.property, {
        configurable: true,
        value: replacement,
        writable: true,
      });
    });

    await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 5,
    });

    expect(Object.getOwnPropertyDescriptor(hookTarget.target, hookTarget.property)).toMatchObject({
      value: replacement,
    });
  });

  it("preserves a page replacement of an action-bound fetch response blob method", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const response = {
      blob: vi.fn(async () => new view.Blob(["synthetic response"])),
      headers: new view.Headers({ "content-type": "application/json" }),
    } as unknown as Response;
    Object.defineProperty(view, "fetch", {
      configurable: true,
      value: vi.fn(async () => response),
      writable: true,
    });
    const replacementBlob = vi.fn(async () => new view.Blob(["page replacement"]));
    documentRef.querySelector("button")?.addEventListener("click", () => {
      void view.fetch("/returns/auth/gstr3b/generated").then((actionResponse) => {
        Object.defineProperty(actionResponse, "blob", {
          configurable: true,
          value: replacementBlob,
          writable: true,
        });
      });
    });

    await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      timeoutMs: 25,
    });

    expect(response.blob).toBe(replacementBlob);
  });

  it("preserves a page replacement of an action-bound pdfMake result method", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const pdf = {
      download: vi.fn(),
      getBlob: vi.fn(),
    };
    const pdfMake = { createPdf: vi.fn(() => pdf) };
    Object.defineProperty(view, "pdfMake", {
      configurable: true,
      value: pdfMake,
      writable: true,
    });
    const replacementDownload = vi.fn();
    documentRef.querySelector("button")?.addEventListener("click", () => {
      const actionPdf = (
        view as unknown as { pdfMake: { createPdf: () => typeof pdf } }
      ).pdfMake.createPdf();
      Object.defineProperty(actionPdf, "download", {
        configurable: true,
        value: replacementDownload,
        writable: true,
      });
    });

    await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      timeoutMs: 25,
    });

    expect(pdf.download).toBe(replacementDownload);
  });

  it.each(["onload", "onloadend", "onreadystatechange"] as const)(
    "immediately exposes and preserves a later native %s handler after the action XHR loses binding",
    async (property) => {
      const { documentRef, view } = installMainWorldDom(`
        <button data-pack-gstr2b-capture-action="capture-1">Download</button>
      `);
      installFakeXhr(view, () => new view.Blob(["synthetic response"]));
      const scheduleUnbound = view.setTimeout.bind(view);
      const originalHandler = vi.fn();
      const replacementHandler = vi.fn();
      let xhr!: XMLHttpRequest;
      let resolveImmediateIdentity!: (matches: boolean) => void;
      const immediateIdentity = new Promise<boolean>((resolve) => {
        resolveImmediateIdentity = resolve;
      });
      documentRef.querySelector("button")?.addEventListener("click", () => {
        xhr = new view.XMLHttpRequest();
        xhr[property] = originalHandler;
        xhr.open("GET", "/returns/auth/gstr3b/generated");
        scheduleUnbound(() => {
          xhr.open("GET", "/returns/auth/gstr3b/reopened");
          xhr[property] = replacementHandler;
          resolveImmediateIdentity(xhr[property] === replacementHandler);
        }, 0);
      });

      const capturePromise = capturePortalBlobDownloadWithDiagnostics({
        ...captureConfig(),
        asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
        timeoutMs: 25,
      });

      expect(await immediateIdentity).toBe(true);
      await capturePromise;
      expect(xhr[property]).toBe(replacementHandler);
    },
  );

  it.each(["load", "loadend"] as const)(
    "preserves %s listener order when the action XHR is reopened outside the action",
    async (eventType) => {
      const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
      installFakeXhr(view, () => new view.Blob(["synthetic response"]));
      const scheduleUnbound = view.setTimeout.bind(view);
      const calls: string[] = [];
      documentRef.querySelector("button")?.addEventListener("click", () => {
        const xhr = new view.XMLHttpRequest();
        xhr.open("GET", "/returns/auth/gstr3b/generated");
        xhr.addEventListener(eventType, () => calls.push("A"));
        scheduleUnbound(() => {
          xhr.open("GET", "/returns/auth/gstr3b/reopened");
          xhr.addEventListener(eventType, () => calls.push("B"));
          xhr.dispatchEvent(new view.Event(eventType));
        }, 0);
      });

      await capturePortalBlobDownloadWithDiagnostics({
        ...captureConfig(),
        asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
        timeoutMs: 25,
      });

      expect(calls).toEqual(["A", "B"]);
    },
  );

  it.each(["promise-then", "queue-microtask"] as const)(
    "preserves a page replacement of the temporary %s continuation hook",
    async (hook) => {
      const { documentRef, view } = installMainWorldDom(`
        <button data-pack-gstr2b-capture-action="capture-1">Download</button>
      `);
      installFakeXhr(view, () => new view.Blob(["synthetic response"]));
      if (hook === "promise-then") {
        const NativePromise = view.Promise;
        class IsolatedPromise<T> extends NativePromise<T> {}
        Object.defineProperty(view, "Promise", {
          configurable: true,
          value: IsolatedPromise,
          writable: true,
        });
      }
      const replacement =
        hook === "promise-then"
          ? vi.fn()
          : vi.fn((callback: VoidFunction) => {
              callback();
            });
      const continuationTarget = hook === "promise-then" ? view.Promise.prototype : view;
      const continuationProperty = hook === "promise-then" ? "then" : "queueMicrotask";
      const originalOwnDescriptor = Object.getOwnPropertyDescriptor(
        continuationTarget,
        continuationProperty,
      );
      documentRef.querySelector("button")?.addEventListener("click", () => {
        const xhr = new view.XMLHttpRequest();
        xhr.open("GET", "/returns/auth/gstr3b/generated");
        xhr.addEventListener("load", () => {
          Object.defineProperty(continuationTarget, continuationProperty, {
            configurable: true,
            value: replacement,
            writable: true,
          });
        });
        xhr.send();
      });

      await capturePortalBlobDownloadWithDiagnostics({
        ...captureConfig(),
        asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
        timeoutMs: 25,
      });

      try {
        expect(
          Object.getOwnPropertyDescriptor(continuationTarget, continuationProperty),
        ).toMatchObject({
          value: replacement,
        });
      } finally {
        if (originalOwnDescriptor) {
          Object.defineProperty(continuationTarget, continuationProperty, originalOwnDescriptor);
        } else {
          delete (continuationTarget as unknown as Record<string, unknown>)[continuationProperty];
        }
      }
    },
  );

  it("preserves a page replacement of an interposed XHR property descriptor", async () => {
    const { documentRef, view } = installMainWorldDom(`
      <button data-pack-gstr2b-capture-action="capture-1">Download</button>
    `);
    const replacementOnload = () => undefined;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      Object.defineProperty(view.XMLHttpRequest.prototype, "onload", {
        configurable: true,
        value: replacementOnload,
        writable: true,
      });
    });

    await capturePortalBlobDownloadWithDiagnostics({
      ...captureConfig(),
      asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
      timeoutMs: 5,
    });

    expect(Object.getOwnPropertyDescriptor(view.XMLHttpRequest.prototype, "onload")).toMatchObject({
      value: replacementOnload,
      writable: true,
    });
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
        "gstr2b-unbound-create-object-url-no-open-selection",
        "gstr2b-main-world-capture-timeout",
      ]),
    });
    expect(nativeClicks).toBe(1);
  });
});

function captureConfig(
  targetBinding: Partial<FiledReturnsMainWorldCaptureRequest["targetBinding"]> = {},
): FiledReturnsMainWorldCaptureRequest {
  const control = document.querySelector<HTMLElement>(
    '[data-pack-gstr2b-capture-action="capture-1"]',
  );
  return {
    actionId: "action-1",
    controlAttribute: "data-pack-gstr2b-capture-action",
    controlId: "capture-1",
    maxBytes: 36 * 1024 * 1024,
    signalPrefix: "gstr2b",
    targetBinding: {
      artifactType: "PDF",
      controlTextDigest: digestTestTargetText(readTestControlText(control)),
      financialYear: "2026-27",
      pathnameDigest: digestTestTargetText(normaliseTestTargetText(window.location.pathname)),
      period: "May",
      returnType: "GSTR-2B",
      ...targetBinding,
    },
  };
}

function configureTestTarget(
  documentRef: Document,
  view: Window & typeof globalThis,
  {
    path,
    returnType,
  }: {
    path: string;
    returnType: "GSTR-1" | "GSTR-2B" | "GSTR-3B";
  },
): void {
  view.history.replaceState(null, "", path);
  const heading = documentRef.querySelector("h1");
  if (heading) heading.textContent = returnType;
}

function installMainWorldDom(html: string): {
  documentRef: Document;
  view: Window & typeof globalThis;
} {
  const dom = new JSDOM(
    `<main>
      <h1>GSTR-2B</h1>
      <p>Financial Year - 2026-27</p>
      <p>Return Period - May</p>
      ${html}
    </main>`,
    {
      url: "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    },
  );
  const view = dom.window as unknown as Window & typeof globalThis;
  Object.defineProperty(view.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ height: 24, width: 120 }],
    writable: true,
  });
  Object.defineProperty(view.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ height: 24, width: 120 }),
    writable: true,
  });
  for (const control of Array.from(
    view.document.querySelectorAll<HTMLElement>('[data-pack-gstr2b-capture-action="capture-1"]'),
  )) {
    if (normaliseTestTargetText(control.textContent ?? "") === "download") {
      control.setAttribute("aria-label", "Download GSTR-2B Summary (PDF)");
    }
  }
  Object.defineProperty(view.URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:https://gstr2b.gst.gov.in/generated",
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

function interceptWindowTimeout(
  view: Window & typeof globalThis,
  interceptedDelay: number,
): Array<() => void> {
  const passthroughSetTimeout = view.setTimeout.bind(view);
  const interceptedCallbacks: Array<() => void> = [];
  let interceptedTimerId = 1_000_000;
  const interceptingSetTimeout = function setTimeout(
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ): number {
    if (timeout !== interceptedDelay) {
      return Reflect.apply(passthroughSetTimeout, view, [handler, timeout, ...args]) as number;
    }
    interceptedCallbacks.push(() => {
      if (typeof handler === "function") Reflect.apply(handler, view, args);
    });
    interceptedTimerId += 1;
    return interceptedTimerId;
  };
  Object.defineProperty(view, "setTimeout", {
    configurable: true,
    value: interceptingSetTimeout,
    writable: true,
  });
  return interceptedCallbacks;
}

function failWindowTimeoutAtDelay(view: Window & typeof globalThis, failedDelay: number) {
  const passthroughSetTimeout = view.setTimeout.bind(view);
  const failingSetTimeout = vi.fn(
    (handler: TimerHandler, timeout?: number, ...args: unknown[]): number => {
      if (timeout === failedDelay) throw new Error("synthetic timer scheduling failure");
      return Reflect.apply(passthroughSetTimeout, view, [handler, timeout, ...args]) as number;
    },
  );
  Object.defineProperty(view, "setTimeout", {
    configurable: true,
    value: failingSetTimeout,
    writable: true,
  });
  return failingSetTimeout;
}

function readTestControlText(control: HTMLElement | null): string {
  if (!control) return "";
  const InputConstructor = control.ownerDocument.defaultView?.HTMLInputElement;
  return normaliseTestTargetText(
    [
      control.innerText || "",
      control.textContent || "",
      InputConstructor && control instanceof InputConstructor ? control.value : "",
      control.getAttribute("aria-label") ?? "",
      control.getAttribute("title") ?? "",
    ].join(" "),
  );
}

function normaliseTestTargetText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function digestTestTargetText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function installFakeXhr(
  view: Window & typeof globalThis,
  responseFactory: () => Blob,
  options: {
    contentType?: string | null;
    scheduleLoad?: (dispatch: () => void) => void;
    scheduleRepeatedEvent?: (
      dispatch: (type: "load" | "loadend" | "readystatechange") => void,
    ) => void;
    status?: number;
    terminalEvent?: "abort" | "error" | "load" | "timeout";
    trustedEvents?: boolean;
    loadEndDispatchCount?: number;
  } = {},
) {
  type FakeListener = {
    capture: boolean;
    listener: EventListenerOrEventListenerObject;
    once: boolean;
  };
  class FakeXhr {
    private loadHandler: ((this: FakeXhr, event: Event) => unknown) | null = null;
    private loadEndHandler: ((this: FakeXhr, event: Event) => unknown) | null = null;
    private readyStateChangeHandler: ((this: FakeXhr, event: Event) => unknown) | null = null;
    readyState = 0;
    response: Blob | null = null;
    status = 0;
    private listeners = new Map<string, FakeListener[]>();

    get onload() {
      return this.loadHandler;
    }

    set onload(handler: ((this: FakeXhr, event: Event) => unknown) | null) {
      this.loadHandler = typeof handler === "function" ? handler : null;
    }

    get onloadend() {
      return this.loadEndHandler;
    }

    set onloadend(handler: ((this: FakeXhr, event: Event) => unknown) | null) {
      this.loadEndHandler = typeof handler === "function" ? handler : null;
    }

    get onreadystatechange() {
      return this.readyStateChangeHandler;
    }

    set onreadystatechange(handler: ((this: FakeXhr, event: Event) => unknown) | null) {
      this.readyStateChangeHandler = typeof handler === "function" ? handler : null;
    }

    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      listenerOptions?: boolean | AddEventListenerOptions,
    ) {
      const capture =
        typeof listenerOptions === "boolean" ? listenerOptions : Boolean(listenerOptions?.capture);
      const signal = typeof listenerOptions === "object" ? listenerOptions.signal : undefined;
      if (
        signal?.aborted ||
        this.listeners
          .get(type)
          ?.some((candidate) => candidate.listener === listener && candidate.capture === capture)
      ) {
        return;
      }
      this.listeners.set(type, [
        ...(this.listeners.get(type) ?? []),
        {
          capture,
          listener,
          once: typeof listenerOptions === "object" && Boolean(listenerOptions.once),
        },
      ]);
      signal?.addEventListener(
        "abort",
        () => this.removeEventListener(type, listener, { capture }),
        { once: true },
      );
    }

    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      listenerOptions?: boolean | EventListenerOptions,
    ) {
      const capture =
        typeof listenerOptions === "boolean" ? listenerOptions : Boolean(listenerOptions?.capture);
      this.listeners.set(
        type,
        (this.listeners.get(type) ?? []).filter(
          (candidate) => candidate.listener !== listener || candidate.capture !== capture,
        ),
      );
    }

    dispatchEvent(event: Event) {
      this.dispatch(event.type, event);
      return !event.defaultPrevented;
    }

    private dispatch(type: string, suppliedEvent?: Event) {
      const event =
        suppliedEvent ??
        ({
          currentTarget: this,
          isTrusted: options.trustedEvents ?? true,
          target: this,
          type,
        } as unknown as Event);
      for (const record of [...(this.listeners.get(type) ?? [])]) {
        if (typeof record.listener === "function") {
          Reflect.apply(record.listener, this, [event]);
        } else {
          Reflect.apply(record.listener.handleEvent, record.listener, [event]);
        }
        if (record.once) this.removeEventListener(type, record.listener, record.capture);
      }
      const propertyHandler =
        type === "load"
          ? this.loadHandler
          : type === "loadend"
            ? this.loadEndHandler
            : type === "readystatechange"
              ? this.readyStateChangeHandler
              : null;
      propertyHandler?.call(this, event);
    }

    getResponseHeader(name: string) {
      if (name.toLowerCase() !== "content-type") return null;
      return Object.hasOwn(options, "contentType")
        ? (options.contentType ?? null)
        : "application/pdf";
    }

    open() {
      this.readyState = 1;
      return undefined;
    }

    send() {
      this.response = responseFactory();
      const dispatch = () => {
        this.readyState = 4;
        this.status = options.status ?? 200;
        this.dispatch("readystatechange");
        this.dispatch(options.terminalEvent ?? "load");
        void view.Promise.resolve().then(() => {
          const loadEndDispatchCount = options.loadEndDispatchCount ?? 1;
          for (let index = 0; index < loadEndDispatchCount; index += 1) {
            this.dispatch("loadend");
          }
          options.scheduleRepeatedEvent?.((type) => this.dispatch(type));
        });
      };
      if (options.scheduleLoad) options.scheduleLoad(dispatch);
      else dispatch();
    }
  }

  Object.defineProperty(view, "XMLHttpRequest", {
    configurable: true,
    value: FakeXhr,
  });
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
}
