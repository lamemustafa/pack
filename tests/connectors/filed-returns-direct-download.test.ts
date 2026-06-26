import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadTarget } from "../../src/core/contracts";
import {
  buildFiledGstr3bGeneratedPdfApiPath,
  buildFiledGstr3bTaxPayableApiPath,
  probeFiledGstr3bGeneratedPdfApi,
  resolveFiledGstr3bGeneratedPdfApiRequest,
} from "../../src/connectors/gst/filed-returns-direct-download";
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
});

function createDetailDocument(url: string, html: string): Document {
  const dom = new JSDOM(html);
  (dom as unknown as { reconfigure(options: { url: string }): void }).reconfigure({ url });
  return dom.window.document;
}
