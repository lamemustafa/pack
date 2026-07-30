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
      const expectedText =
        artifactType === "PDF"
          ? "DOWNLOAD GSTR-2B SUMMARY (PDF)"
          : "DOWNLOAD GSTR-2B DETAILS (EXCEL)";
      const control = Array.from(documentRef.querySelectorAll("button")).find(
        (element) => element.textContent === expectedText,
      );
      expect(control?.getAttribute("data-pack-artifact-request")).toBe(request.requestId);
      expect(documentRef.querySelectorAll("[data-pack-artifact-request]").length).toBe(1);
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
    const scopedRegionText = documentRef.querySelector("main section")?.textContent ?? "";
    expect(scopedRegionText).not.toMatch(/\bgstr[\s-]?1\b/i);
    expect(scopedRegionText).toContain("GSTR-3B table");

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
    const artifactControl = documentRef.querySelector("[data-testid='artifact-control']");
    expect(artifactControl?.textContent).toContain("DOWNLOAD SUMMARY (PDF)");
    expect(artifactControl?.textContent).toContain("DOWNLOAD (PDF)");
    expect(artifactControl?.getAttribute("data-pack-artifact-request")).toBe(request.requestId);
    expect(documentRef.querySelectorAll("[data-pack-artifact-request]").length).toBe(1);
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
        documentRef
          .querySelector("[data-testid='artifact-control']")
          ?.getAttribute("data-pack-artifact-request"),
      ).toBeNull();
    },
  );

  it("fails closed when matching identity text is available only through whole-body fallback", async () => {
    const { documentRef, fetch } = gstr1WholeBodyFallbackPage(gstr1Json("042026"));

    await expect(acquireFiledReturnArtifact(documentRef, request)).resolves.toEqual({
      ok: false,
      reason: "page-period-mismatch",
      requestId: request.requestId,
      safeSignals: [
        "target-period-verified",
        "page-target-unverified",
        "page-identity-region-not-found",
      ],
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(documentRef.querySelector("button")?.getAttribute("data-pack-artifact-request")).toBe(
      null,
    );
  });

  it("fails closed when the selected control region contains conflicting period identities", async () => {
    const { documentRef } = gstr1Page(gstr1Json("042026"));
    const section = documentRef.querySelector("main section");
    const conflictingIdentity = documentRef.createElement("p");
    conflictingIdentity.textContent = "FY - 2026-27 Tax Period - May Status - Filed";
    section?.append(conflictingIdentity);

    await expect(acquireFiledReturnArtifact(documentRef, request)).resolves.toMatchObject({
      ok: false,
      reason: "page-period-mismatch",
      safeSignals: ["target-period-verified", "page-target-unverified"],
    });
    expect(
      documentRef
        .querySelector("[data-testid='artifact-control']")
        ?.getAttribute("data-pack-artifact-request"),
    ).toBeNull();
  });

  it("rejects a clickable ancestor whose text is composed from separate leaf controls", async () => {
    const { documentRef } = gstr1Page(gstr1Json("042026"));
    const artifactControl = documentRef.querySelector("[data-testid='artifact-control']");
    const ancestor = documentRef.createElement("div");
    ancestor.setAttribute("role", "button");
    ancestor.innerHTML = "<button>DOWNLOAD SUMMARY</button> <button>(PDF)</button>";
    artifactControl?.replaceWith(ancestor);

    await expect(acquireFiledReturnArtifact(documentRef, request)).resolves.toEqual({
      ok: false,
      reason: "control-not-found",
      requestId: request.requestId,
      safeSignals: ["target-period-verified"],
    });
    expect(documentRef.querySelectorAll("[data-pack-artifact-request]").length).toBe(0);
  });

  it("recognises a canonical Angular leaf control without relaxing uniqueness", async () => {
    const { documentRef } = gstr1Page(gstr1Json("042026"));
    const artifactControl = documentRef.querySelector("[data-testid='artifact-control']");
    const angularControl = documentRef.createElement("span");
    angularControl.setAttribute("ng-click", "downloadSummary() ");
    angularControl.textContent = "DOWNLOAD SUMMARY (PDF)";
    artifactControl?.replaceWith(angularControl);

    await expect(acquireFiledReturnArtifact(documentRef, request)).resolves.toMatchObject({
      ok: true,
      state: "ready",
      requestId: request.requestId,
    });
    expect(angularControl.getAttribute("data-pack-artifact-request")).toBe(request.requestId);
  });

  it("fails closed when a matching canonical control contains an input control descendant", async () => {
    const { documentRef } = gstr1Page(gstr1Json("042026"));
    const artifactControl = documentRef.querySelector("[data-testid='artifact-control']");
    const ancestor = documentRef.createElement("button");
    ancestor.textContent = "DOWNLOAD SUMMARY (PDF)";
    const nestedInput = documentRef.createElement("input");
    nestedInput.type = "button";
    nestedInput.value = "Decorative action";
    ancestor.append(nestedInput);
    artifactControl?.replaceWith(ancestor);

    await expect(acquireFiledReturnArtifact(documentRef, request)).resolves.toEqual({
      ok: false,
      reason: "control-not-found",
      requestId: request.requestId,
      safeSignals: ["target-period-verified"],
    });
    expect(documentRef.querySelectorAll("[data-pack-artifact-request]").length).toBe(0);
  });

  it("fails closed when multiple leaf controls contain the canonical label", async () => {
    const { documentRef } = gstr1Page(gstr1Json("042026"));
    const duplicate = documentRef.createElement("button");
    duplicate.textContent = "DOWNLOAD SUMMARY (PDF)";
    documentRef.querySelector("main section")?.append(duplicate);

    await expect(acquireFiledReturnArtifact(documentRef, request)).resolves.toEqual({
      ok: false,
      reason: "control-not-found",
      requestId: request.requestId,
      safeSignals: ["target-period-verified"],
    });
    expect(documentRef.querySelectorAll("[data-pack-artifact-request]").length).toBe(0);
  });

  it("binds identity verification to the exact requested artifact control", async () => {
    const { documentRef } = gstr1SplitArtifactRegionsPage(gstr1Json("042026"));

    await expect(
      acquireFiledReturnArtifact(documentRef, { ...request, artifactType: "EXCEL" }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "page-period-mismatch",
      safeSignals: ["target-period-verified", "page-target-unverified"],
    });
    expect(
      Array.from(documentRef.querySelectorAll("button")).map((control) =>
        control.getAttribute("data-pack-artifact-request"),
      ),
    ).toEqual([null, null]);
  });

  it("arms the E-invoice workbook only on the matching GSTR-1 detail page", async () => {
    const { documentRef } = gstr1Page(
      gstr1Json("042026"),
      "https://return.gst.gov.in/returns/auth/gstr1",
      "DOWNLOAD DETAILS FROM E-INVOICES (EXCEL)",
    );

    await expect(
      acquireFiledReturnArtifact(documentRef, { ...request, artifactType: "EXCEL" }),
    ).resolves.toMatchObject({ ok: true, state: "ready" });
    const artifactControl = documentRef.querySelector("[data-testid='artifact-control']");
    expect(artifactControl?.textContent).toBe("DOWNLOAD DETAILS FROM E-INVOICES (EXCEL)");
    expect(artifactControl?.getAttribute("data-pack-artifact-request")).toBe(request.requestId);
    expect(documentRef.querySelectorAll("[data-pack-artifact-request]").length).toBe(1);
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
    `<body>
      <a>Downloads</a>
      <button>View/Download Certificates</button>
      <button>DOWNLOAD ADVISORY</button>
      <button>E-INVOICE DOWNLOAD HISTORY</button>
      <button hidden>GENERATE SUMMARY</button>
      <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
      <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
    </body>`,
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
  controlMarkup = "<span>DOWNLOAD SUMMARY (PDF)</span> <span hidden>DOWNLOAD (PDF)</span>",
  status = 200,
) {
  const dom = new JSDOM(
    `<body>
      <nav>
        <a>Status Track</a>
        <a>Status Home</a>
        <a>Status Transition</a>
        <a>Status Application</a>
        <a>GSTR-3B - Monthly Return</a>
        <a>Downloads</a>
      </nav>
      <main>
        <h1>GSTR-1 Summary</h1>
        <section>
          <p>GSTIN - 00XXXXX0000X0Z0</p>
          <p>Legal Name - Synthetic Legal Name Pvt Ltd</p>
          <p>Trade Name - Synthetic Trade Name</p>
          <p>FY - 2026-27</p>
          <p>Tax Period - April</p>
          <p>Status - Filed</p>
          <p>GSTR-3B table</p>
          <button>View/Download Certificates</button>
          <button>DOWNLOAD ADVISORY</button>
          <button>E-INVOICE DOWNLOAD HISTORY</button>
          <button hidden>GENERATE SUMMARY</button>
          <button data-testid="artifact-control">${controlMarkup}</button>
        </section>
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

function gstr1WholeBodyFallbackPage(body: string) {
  const dom = new JSDOM(
    `<body>
      <main>
        <section>
          <h1>GSTR-1 Summary</h1>
          <p>GSTIN - 00XXXXX0000X0Z0</p>
          <p>Legal Name - Synthetic Legal Name Pvt Ltd</p>
          <p>Trade Name - Synthetic Trade Name</p>
          <p>FY - 2026-27</p>
          <p>Tax Period - April</p>
          <p>Status - Filed</p>
        </section>
      </main>
      <button>DOWNLOAD SUMMARY (PDF)</button>
    </body>`,
    { url: "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum" },
  );
  const fetch = vi.fn(async () => new Response(body));
  Object.defineProperty(dom.window, "fetch", { configurable: true, value: fetch });
  return { documentRef: dom.window.document, fetch };
}

function gstr1SplitArtifactRegionsPage(body: string) {
  const dom = new JSDOM(
    `<body>
      <main>
        <section>
          <h1>GSTR-1 Summary</h1>
          <p>FY - 2026-27 Tax Period - April Status - Filed</p>
          <button>DOWNLOAD SUMMARY (PDF)</button>
        </section>
        <section>
          <h1>GSTR-1 E-invoice Details</h1>
          <p>FY - 2026-27 Tax Period - May Status - Filed</p>
          <button>DOWNLOAD DETAILS FROM E-INVOICES (EXCEL)</button>
        </section>
      </main>
    </body>`,
    { url: "https://return.gst.gov.in/returns/auth/gstr1" },
  );
  const fetch = vi.fn(async () => new Response(body));
  Object.defineProperty(dom.window, "fetch", { configurable: true, value: fetch });
  return { documentRef: dom.window.document, fetch };
}

function gstr1Json(returnPeriod: string) {
  return JSON.stringify({ data: { ret_period: returnPeriod, padding: "x".repeat(100) } });
}
