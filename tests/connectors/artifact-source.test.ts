import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  acquireFiledReturnArtifact,
  type ArtifactRequest,
} from "../../src/connectors/gst/artifact-source";

const REQUEST: ArtifactRequest = {
  artifactType: "JSON",
  financialYear: "2024-25",
  period: "April",
  requestId: "request-1",
  returnPeriod: "042024",
  returnType: "GSTR-3B",
};

describe("acquireFiledReturnArtifact", () => {
  it("returns the raw response bytes without reserialising them", async () => {
    const raw =
      '{  "status":1, "data" : {"r3b":{"ret_period":"042024"}}, "padding":"' +
      "x".repeat(100) +
      '" }';
    const { documentRef, fetch } = page(raw);
    const result = await acquireFiledReturnArtifact(documentRef, REQUEST);
    expect(result).toMatchObject({
      ok: true,
      mimeType: "application/json",
      safeSignals: ["target-period-verified"],
    });
    if (!result.ok || result.state !== "acquired") return;
    expect(new TextDecoder().decode(result.bytes)).toBe(raw);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("fails closed before a click when preflight target mismatches", async () => {
    const { documentRef } = page(
      JSON.stringify({
        status: 1,
        data: { r3b: { ret_period: "052024" } },
        padding: "x".repeat(100),
      }),
    );
    const click = vi.fn();
    documentRef.body.addEventListener("click", click);
    await expect(acquireFiledReturnArtifact(documentRef, REQUEST)).resolves.toMatchObject({
      ok: false,
      reason: "target-period-mismatch",
    });
    expect(click).not.toHaveBeenCalled();
  });

  it("rejects failed preflight and never fetches on the wrong page", async () => {
    const denied = page("{}", 403);
    await expect(acquireFiledReturnArtifact(denied.documentRef, REQUEST)).resolves.toMatchObject({
      ok: false,
      reason: "not-authenticated",
    });
    const wrong = page("{}", 200, "https://example.test/not-gst");
    await expect(acquireFiledReturnArtifact(wrong.documentRef, REQUEST)).resolves.toMatchObject({
      ok: false,
      reason: "wrong-page",
    });
    expect(wrong.fetch).not.toHaveBeenCalled();
  });

  it("keeps diagnostics category-only", async () => {
    const { documentRef } = page(
      JSON.stringify({
        status: 1,
        data: { r3b: { ret_period: "052024" } },
        padding: "x".repeat(100),
      }),
    );
    const result = await acquireFiledReturnArtifact(documentRef, REQUEST);
    const signals = result.safeSignals.join(" ");
    expect(signals).not.toMatch(/http|gst\.gov\.in|\?|\/|\d{6,}/i);
  });

  it("returns an explicit ready result after arming one PDF control", async () => {
    const { documentRef } = page(validJson());
    const result = await acquireFiledReturnArtifact(documentRef, {
      ...REQUEST,
      artifactType: "PDF",
    });

    expect(result).toEqual({
      ok: true,
      requestId: REQUEST.requestId,
      safeSignals: ["target-period-verified", "page-generated-pdf-ready"],
      state: "ready",
    });
    expect(documentRef.querySelector("button")?.getAttribute("data-pack-artifact-request")).toBe(
      REQUEST.requestId,
    );
  });

  it("fails closed when the PDF preflight finds duplicate visible controls", async () => {
    const { documentRef } = page(validJson());
    const duplicate = documentRef.createElement("button");
    duplicate.textContent = "Download Filed GSTR-3B";
    documentRef.body.append(duplicate);
    const click = vi.fn();
    documentRef.body.addEventListener("click", click);

    await expect(
      acquireFiledReturnArtifact(documentRef, { ...REQUEST, artifactType: "PDF" }),
    ).resolves.toEqual({
      ok: false,
      reason: "control-not-found",
      requestId: REQUEST.requestId,
      safeSignals: ["target-period-verified"],
    });
    expect(click).not.toHaveBeenCalled();
  });
});

function validJson() {
  return JSON.stringify({
    status: 1,
    data: { r3b: { ret_period: REQUEST.returnPeriod } },
    padding: "x".repeat(100),
  });
}

function page(body: string, status = 200, url = "https://return.gst.gov.in/returns/auth/gstr3b") {
  const dom = new JSDOM(
    "<body><h1>GSTR-3B - Monthly Return</h1><p>Status - Filed</p><button>Download Filed GSTR-3B</button></body>",
    { url },
  );
  Object.defineProperty(
    (dom.window as unknown as typeof globalThis).HTMLElement.prototype,
    "getBoundingClientRect",
    {
      configurable: true,
      value: () => ({
        bottom: 10,
        height: 10,
        left: 0,
        right: 10,
        top: 0,
        width: 10,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    },
  );
  const fetch = vi.fn(async () => new Response(body, { status }));
  Object.defineProperty(dom.window, "fetch", { configurable: true, value: fetch });
  return { documentRef: dom.window.document, fetch };
}
