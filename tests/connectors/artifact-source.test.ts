import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  acquireFiledReturnArtifact,
  ARTIFACT_FAILURE_MESSAGES,
  type ArtifactRequest,
  type ArtifactFailureReason,
} from "../../src/connectors/gst/artifact-source";
import { extractFiledReturnsDetailIdentity } from "../../src/connectors/gst/filed-returns-detail-identity";
import { GSTR2B_JSON_PATH } from "../../src/connectors/gst/portal-artifact-endpoints";

const REQUEST: ArtifactRequest = {
  artifactType: "JSON",
  financialYear: "2024-25",
  period: "April",
  requestId: "request-1",
  returnPeriod: "042024",
  returnType: "GSTR-3B",
};

describe("acquireFiledReturnArtifact", () => {
  it("maps every artifact failure reason to a user-facing message", () => {
    for (const reason of Object.keys(ARTIFACT_FAILURE_MESSAGES) as ArtifactFailureReason[]) {
      expect(ARTIFACT_FAILURE_MESSAGES[reason].trim()).not.toBe("");
    }
    expect(new Set(Object.values(ARTIFACT_FAILURE_MESSAGES)).size).toBe(
      Object.keys(ARTIFACT_FAILURE_MESSAGES).length,
    );
  });

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

  it("rejects a requested period that does not match the visible detail page", async () => {
    const { documentRef, fetch } = page(validJson());
    documentRef.body.innerHTML = documentRef.body.innerHTML.replaceAll("April", "May");
    const click = vi.fn();
    documentRef.body.addEventListener("click", click);

    await expect(acquireFiledReturnArtifact(documentRef, REQUEST)).resolves.toEqual({
      ok: false,
      reason: "page-period-mismatch",
      requestId: REQUEST.requestId,
      safeSignals: ["page-target-unverified"],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});

describe("GSTR-2B artifact acquisition", () => {
  const request: ArtifactRequest = {
    artifactType: "JSON",
    financialYear: "2024-25",
    period: "April",
    requestId: "gstr2b-request",
    returnPeriod: "042024",
    returnType: "GSTR-2B",
  };

  it("reuses byte-identical raw getjson bytes for JSON", async () => {
    const raw = `{ "data" : { "rtnprd" : "042024", "padding":"${"x".repeat(100)}" }, "chksum":"synthetic" }`;
    const { documentRef, fetch } = gstr2bPage(raw);
    const result = await acquireFiledReturnArtifact(documentRef, request);
    expect(result).toMatchObject({ ok: true, state: "acquired", mimeType: "application/json" });
    if (!result.ok || result.state !== "acquired") return;
    expect(new TextDecoder().decode(result.bytes)).toBe(raw);
    const [requestedPath, options] =
      (fetch.mock.calls[0] as [RequestInfo | URL, RequestInit] | undefined) ?? [];
    const requestedUrl = new URL(String(requestedPath), "https://synthetic.test");
    expect(requestedUrl.pathname).toBe(GSTR2B_JSON_PATH);
    expect(requestedUrl.searchParams.get("rtnprd")).toBe(request.returnPeriod);
    expect(options).toEqual({
      credentials: "same-origin",
    });
  });

  it("fails before any click when the nested target period differs", async () => {
    const { documentRef } = gstr2bPage(gstr2bJson("052024"));
    const click = vi.fn();
    documentRef.body.addEventListener("click", click);
    await expect(acquireFiledReturnArtifact(documentRef, request)).resolves.toMatchObject({
      ok: false,
      reason: "target-period-mismatch",
    });
    expect(click).not.toHaveBeenCalled();
  });

  it("rejects a getjson response without the requested return period", async () => {
    const { documentRef } = gstr2bPage(
      JSON.stringify({ data: { padding: "x".repeat(100) }, chksum: "synthetic" }),
    );

    await expect(acquireFiledReturnArtifact(documentRef, request)).resolves.toMatchObject({
      ok: false,
      reason: "unexpected-content",
    });
  });

  it.each(["PDF", "EXCEL"] as const)(
    "arms exactly one GSTR-2B %s summary control",
    async (artifactType) => {
      const { documentRef } = gstr2bPage(gstr2bJson("042024"));
      const result = await acquireFiledReturnArtifact(documentRef, { ...request, artifactType });
      expect(result).toMatchObject({ ok: true, state: "ready" });
      const control = Array.from(documentRef.querySelectorAll("button")).find((element) =>
        element.textContent?.includes(artifactType === "PDF" ? "SUMMARY" : "DETAILS"),
      );
      expect(control?.getAttribute("data-pack-artifact-request")).toBe(request.requestId);
    },
  );

  it("fails closed on HTTP failure or a non-summary page", async () => {
    const denied = gstr2bPage("{}", 500);
    await expect(acquireFiledReturnArtifact(denied.documentRef, request)).resolves.toMatchObject({
      ok: false,
      reason: "preflight-failed",
    });
    const wrongPage = gstr2bPage(
      gstr2bJson("042024"),
      200,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2bdwld",
    );
    await expect(
      acquireFiledReturnArtifact(wrongPage.documentRef, { ...request, artifactType: "PDF" }),
    ).resolves.toMatchObject({ ok: false, reason: "wrong-page" });
  });
});

describe("GSTR-1 artifact acquisition", () => {
  const request: ArtifactRequest = {
    artifactType: "PDF",
    financialYear: "2026-27",
    period: "April",
    requestId: "gstr1-request",
    returnPeriod: "042026",
    returnType: "GSTR-1",
  };

  it("preflights with rtn_prd and accepts data.ret_period without a status field", async () => {
    const { documentRef, fetch } = gstr1Page(gstr1Json("042026"));

    expect(extractFiledReturnsDetailIdentity(documentRef, "GSTR-1")).toEqual({
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-1",
      safeSignals: [
        "filed-return-detail-period:April",
        "filed-return-detail-financial-year:2026-27",
        "filed-return-detail-type:GSTR-1",
      ],
    });

    await expect(acquireFiledReturnArtifact(documentRef, request)).resolves.toMatchObject({
      ok: true,
      safeSignals: ["target-period-verified", "page-generated-pdf-ready"],
      state: "ready",
    });
    const [requestedPath, options] =
      (fetch.mock.calls[0] as [RequestInfo | URL, RequestInit] | undefined) ?? [];
    const requestedUrl = new URL(String(requestedPath), "https://synthetic.test");
    expect(requestedUrl.pathname).toBe("/returns/auth/api/gstr1/summary");
    expect(requestedUrl.searchParams.get("rtn_prd")).toBe(request.returnPeriod);
    expect(options).toEqual({ credentials: "same-origin" });
    expect(documentRef.querySelector("button")?.getAttribute("data-pack-artifact-request")).toBe(
      request.requestId,
    );
  });

  it.each([
    [
      "missing period",
      JSON.stringify({ data: { padding: "x".repeat(100) } }),
      "unexpected-content",
    ],
    ["wrong period", gstr1Json("052026"), "target-period-mismatch"],
  ] as const)("fails closed for %s before clicking", async (_label, responseBody, reason) => {
    const { documentRef } = gstr1Page(responseBody);
    const click = vi.fn();
    documentRef.body.addEventListener("click", click);

    await expect(acquireFiledReturnArtifact(documentRef, request)).resolves.toMatchObject({
      ok: false,
      reason,
    });
    expect(click).not.toHaveBeenCalled();
  });

  it("fails closed for an HTTP failure or HTML preflight response", async () => {
    const denied = gstr1Page("{}", undefined, undefined, 500);
    await expect(acquireFiledReturnArtifact(denied.documentRef, request)).resolves.toMatchObject({
      ok: false,
      reason: "preflight-failed",
    });

    const html = gstr1Page("<!doctype html><html><body>synthetic</body></html>");
    await expect(acquireFiledReturnArtifact(html.documentRef, request)).resolves.toMatchObject({
      ok: false,
      reason: "preflight-failed",
    });
  });

  it.each([
    ["period", "April", "May"],
    ["financial year", "2026-27", "2025-26"],
    ["return type", "GSTR-1 Summary", "GSTR-3B - Monthly Return"],
  ] as const)(
    "fails closed on the live header shape when the visible %s is stale",
    async (_label, currentValue, staleValue) => {
      const { documentRef, fetch } = gstr1Page(gstr1Json("042026"));
      documentRef.body.innerHTML = documentRef.body.innerHTML.replaceAll(currentValue, staleValue);

      await expect(acquireFiledReturnArtifact(documentRef, request)).resolves.toMatchObject({
        ok: false,
        reason: "page-period-mismatch",
        safeSignals: ["target-period-verified", "page-target-unverified"],
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(
        documentRef.querySelector("button")?.getAttribute("data-pack-artifact-request"),
      ).toBeNull();
    },
  );

  it("arms the E-invoice workbook only on the matching GSTR-1 detail page", async () => {
    const { documentRef } = gstr1Page(
      gstr1Json("042026"),
      "https://return.gst.gov.in/returns/auth/gstr1",
      "DOWNLOAD DETAILS FROM E-INVOICES (EXCEL)",
    );

    await expect(
      acquireFiledReturnArtifact(documentRef, { ...request, artifactType: "EXCEL" }),
    ).resolves.toMatchObject({ ok: true, state: "ready" });
    expect(documentRef.querySelector("button")?.getAttribute("data-pack-artifact-request")).toBe(
      request.requestId,
    );
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
    "<body><main><h1>GSTR-3B - Monthly Return</h1><p>Status - Filed</p><p>Financial Year - 2024-25</p><p>Return Period - April</p><button aria-label='Download Filed GSTR-3B Financial Year 2024-25 Return Period April'>Download Filed GSTR-3B</button></main></body>",
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

function gstr2bPage(
  body: string,
  status = 200,
  url = "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
) {
  const dom = new JSDOM(
    "<body><button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button><button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button></body>",
    { url },
  );
  const fetch = vi.fn(async () => new Response(body, { status }));
  Object.defineProperty(dom.window, "fetch", { configurable: true, value: fetch });
  return { documentRef: dom.window.document, fetch };
}

function gstr2bJson(returnPeriod: string) {
  return JSON.stringify({
    data: { rtnprd: returnPeriod, padding: "x".repeat(100) },
    chksum: "synthetic",
  });
}

function gstr1Page(
  body: string,
  url = "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum",
  controlText = "DOWNLOAD SUMMARY (PDF)",
  status = 200,
) {
  const dom = new JSDOM(
    `<body>
      <main>
        <h1>GSTR-1 Summary</h1>
        <p>GSTIN - 00XXXXX0000X0Z0</p>
        <p>Legal Name - Synthetic Legal Name Pvt Ltd</p>
        <p>Trade Name - Synthetic Trade Name</p>
        <p>FY - 2026-27</p>
        <p>Tax Period - April</p>
        <p>Status - Filed</p>
        <button>${controlText}</button>
      </main>
    </body>`,
    { url },
  );
  Object.defineProperty(
    (dom.window as unknown as typeof globalThis).HTMLElement.prototype,
    "getBoundingClientRect",
    {
      configurable: true,
      value: () => ({ bottom: 10, height: 10, left: 0, right: 10, top: 0, width: 10 }),
    },
  );
  const fetch = vi.fn(async () => new Response(body, { status }));
  Object.defineProperty(dom.window, "fetch", { configurable: true, value: fetch });
  return { documentRef: dom.window.document, fetch };
}

function gstr1Json(returnPeriod: string) {
  return JSON.stringify({ data: { ret_period: returnPeriod, padding: "x".repeat(100) } });
}
