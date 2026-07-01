import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadTarget } from "../../src/core/contracts";
import {
  buildFiledGstr3bGeneratedPdfApiPath,
  buildFiledGstr3bTaxPayableApiPath,
  resolveFiledGstr3bGeneratedPdfApiRequest,
} from "../../src/connectors/gst/filed-returns-direct-download";
import {
  probeFiledGstr3bGeneratedPdfApi,
  resolveFiledGstr3bVerifiedPdfDownloadRequest,
} from "../../src/connectors/gst/filed-returns-direct-download-probe";
import { toPortalReturnPeriod } from "../../src/connectors/gst/filed-returns-return-period";

const TARGET: FiledReturnsDownloadTarget = {
  actionId: "action",
  financialYear: "2025-26",
  period: "March",
  returnType: "GSTR-3B",
};

describe("filed returns direct download request helpers", () => {
  it("builds target-bound final GSTR-3B PDF endpoint paths without portal identifiers", () => {
    expect(toPortalReturnPeriod("March", "2025-26")).toBe("032026");
    expect(buildFiledGstr3bGeneratedPdfApiPath("032026")).toBe(
      "/returns/auth/api/gstr3b/getgenpdf?rtn_prd=032026",
    );
    expect(buildFiledGstr3bTaxPayableApiPath("032026")).toBe(
      "/returns/auth/api/gstr3b/taxpayble?rtn_prd=032026",
    );
  });

  it("resolves a synthetic PDF request only on the matching GST GSTR-3B detail page", () => {
    const documentRef = createDetailDocument(
      "https://return.gst.gov.in/returns/auth/gstr3b",
      `
        <main>
          <h1>GSTR-3B - Monthly Return</h1>
          <p>Financial Year: 2025-26</p>
          <p>Return Period: March</p>
          <button>Download Filed GSTR-3B</button>
        </main>
      `,
    );

    const resolved = resolveFiledGstr3bGeneratedPdfApiRequest(documentRef, TARGET);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.pdfPath).toBe("/returns/auth/api/gstr3b/getgenpdf?rtn_prd=032026");
    expect(resolved.preflightPath).toBe("/returns/auth/api/gstr3b/taxpayble?rtn_prd=032026");
    expect(resolved.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr-3b-detail-route",
        "filed-return-detail-period:March",
        "filed-return-detail-financial-year:2025-26",
        "filed-gstr3b-direct-download-path-built",
      ]),
    );
  });

  it("accepts compact portal detail labels and non-hyphenated financial years", () => {
    const documentRef = createDetailDocument(
      "https://return.gst.gov.in/returns/auth/gstr3b",
      `
        <main>
          <h1>GSTR-3B - Monthly Return</h1>
          <p>FinancialYear: 202526</p>
          <p>ReturnPeriod: March</p>
          <button>Download Filed GSTR-3B</button>
        </main>
      `,
    );

    const resolved = resolveFiledGstr3bGeneratedPdfApiRequest(documentRef, TARGET);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-detail-period:March",
        "filed-return-detail-financial-year:2025-26",
      ]),
    );
  });

  it("blocks direct PDF requests until the visible detail page exposes the target identity", () => {
    const documentRef = createDetailDocument(
      "https://return.gst.gov.in/returns/auth/gstr3b",
      "<main></main>",
    );
    documentRef.defaultView?.localStorage.setItem("rtn_prd", "032026");

    const resolved = resolveFiledGstr3bGeneratedPdfApiRequest(documentRef, TARGET);

    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.result.state).toBe("blocked");
    expect(resolved.result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr-3b-detail-route",
        "filed-gstr3b-direct-download-visible-identity-missing",
        "filed-return-download-target-mismatch",
      ]),
    );
  });

  it("blocks synthetic PDF requests when the visible detail page does not match the target", () => {
    const documentRef = createDetailDocument(
      "https://return.gst.gov.in/returns/auth/gstr3b",
      `
        <main>
          <h1>GSTR-3B - Monthly Return</h1>
          <p>Financial Year: 2025-26</p>
          <p>Return Period: February</p>
          <button>Download Filed GSTR-3B</button>
        </main>
      `,
    );

    const resolved = resolveFiledGstr3bGeneratedPdfApiRequest(documentRef, TARGET);

    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.result.state).toBe("blocked");
    expect(resolved.result.safeSignals).toContain("filed-return-download-target-mismatch");
  });

  it("blocks blank detail route PDF requests even when stored return period does not match the target", () => {
    const documentRef = createDetailDocument(
      "https://return.gst.gov.in/returns/auth/gstr3b",
      "<main></main>",
    );
    documentRef.defaultView?.localStorage.setItem("rtn_prd", "022026");

    const resolved = resolveFiledGstr3bGeneratedPdfApiRequest(documentRef, TARGET);

    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.result.state).toBe("blocked");
    expect(resolved.result.safeSignals).toContain(
      "filed-gstr3b-direct-download-visible-identity-missing",
    );
  });

  it("blocks synthetic PDF requests without a Pack action id", () => {
    const documentRef = createDetailDocument(
      "https://return.gst.gov.in/returns/auth/gstr3b",
      `
        <main>
          <h1>GSTR-3B - Monthly Return</h1>
          <p>Financial Year: 2025-26</p>
          <p>Return Period: March</p>
          <button>Download Filed GSTR-3B</button>
        </main>
      `,
    );

    const resolved = resolveFiledGstr3bGeneratedPdfApiRequest(documentRef, {
      ...TARGET,
      actionId: "",
    });

    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.result.state).toBe("blocked");
    expect(resolved.result.safeSignals).toContain("filed-gstr3b-direct-download-action-id-missing");
  });

  it("probes only response metadata and never reads the PDF body", async () => {
    const documentRef = createDetailDocument(
      "https://return.gst.gov.in/returns/auth/gstr3b",
      `
        <main>
          <h1>GSTR-3B - Monthly Return</h1>
          <p>Financial Year: 2025-26</p>
          <p>Return Period: March</p>
          <button>Download Filed GSTR-3B</button>
        </main>
      `,
    );
    const json = vi.fn();
    const text = vi.fn();
    const arrayBuffer = vi.fn();
    const blob = vi.fn();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "application/pdf",
        "content-length": "123",
        "content-disposition": "attachment",
      }),
      json,
      text,
      arrayBuffer,
      blob,
      body: { cancel },
    });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(documentRef.defaultView, "fetch", {
      configurable: true,
      value: fetchMock,
    });

    const result = await probeFiledGstr3bGeneratedPdfApi(documentRef, TARGET);

    expect(result.state).toBe("available");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-gstr3b-direct-download-probed",
        "filed-gstr3b-direct-download-content-type-present",
        "filed-gstr3b-direct-download-disposition-present",
      ]),
    );
    expect(fetchMock).toHaveBeenCalledWith("/returns/auth/api/gstr3b/getgenpdf?rtn_prd=032026", {
      credentials: "same-origin",
      headers: { Accept: "application/pdf,application/octet-stream,*/*" },
      method: "GET",
    });
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(blob).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("resolves a direct download URL only after the authenticated page probe looks like a PDF", async () => {
    const documentRef = createMatchingDetailDocument();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "application/pdf",
        "content-length": "123",
        "content-disposition": "attachment",
      }),
      arrayBuffer: vi.fn(),
      body: { cancel },
    });
    Object.defineProperty(documentRef.defaultView, "fetch", {
      configurable: true,
      value: fetchMock,
    });

    const result = await resolveFiledGstr3bVerifiedPdfDownloadRequest(documentRef, TARGET);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fetchMock).toHaveBeenCalledWith("/returns/auth/api/gstr3b/getgenpdf?rtn_prd=032026", {
      credentials: "same-origin",
      headers: { Accept: "application/pdf,application/octet-stream,*/*" },
      method: "GET",
    });
    expect(result.pdfPath).toBe("/returns/auth/api/gstr3b/getgenpdf?rtn_prd=032026");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-gstr3b-direct-download-probed",
        "filed-gstr3b-direct-download-probe-accepted",
      ]),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.results[0]).toBeDefined();
  });

  it("blocks the direct URL path when GST exposes HTML instead of a PDF", async () => {
    const documentRef = createDetailDocument(
      "https://return.gst.gov.in/returns/auth/gstr3b",
      `
        <main>
          <h1>GSTR-3B - Monthly Return</h1>
          <p>Financial Year: 2025-26</p>
          <p>Return Period: March</p>
          <button>Download Filed GSTR-3B</button>
        </main>
      `,
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      arrayBuffer: vi.fn(),
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    });
    Object.defineProperty(documentRef.defaultView, "fetch", {
      configurable: true,
      value: fetchMock,
    });

    const result = await resolveFiledGstr3bVerifiedPdfDownloadRequest(documentRef, TARGET);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.state).toBe("blocked");
    expect(result.result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr3b-direct-download-non-pdf-response"]),
    );
  });

  it("accepts a generic binary content type when probing the direct URL", async () => {
    const documentRef = createMatchingDetailDocument();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/octet-stream" }),
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    });
    Object.defineProperty(documentRef.defaultView, "fetch", {
      configurable: true,
      value: fetchMock,
    });

    const result = await resolveFiledGstr3bVerifiedPdfDownloadRequest(documentRef, TARGET);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.safeSignals).toContain("filed-gstr3b-direct-download-probe-accepted");
  });

  it("blocks direct PDF fetch failures", async () => {
    const documentRef = createMatchingDetailDocument();
    const fetchMock = vi.fn().mockRejectedValue(new Error("network failed"));
    Object.defineProperty(documentRef.defaultView, "fetch", {
      configurable: true,
      value: fetchMock,
    });

    const result = await resolveFiledGstr3bVerifiedPdfDownloadRequest(documentRef, TARGET);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.safeSignals).toContain("filed-gstr3b-direct-download-fetch-failed");
  });
});

function createMatchingDetailDocument(): Document {
  return createDetailDocument(
    "https://return.gst.gov.in/returns/auth/gstr3b",
    `
      <main>
        <h1>GSTR-3B - Monthly Return</h1>
        <p>Financial Year: 2025-26</p>
        <p>Return Period: March</p>
        <button>Download Filed GSTR-3B</button>
      </main>
    `,
  );
}

function createDetailDocument(url: string, html: string): Document {
  const dom = new JSDOM(html);
  (dom as unknown as { reconfigure(options: { url: string }): void }).reconfigure({ url });
  return dom.window.document;
}
