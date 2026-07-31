import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { FiledReturnsDownloadTarget } from "../../src/connectors/gst/filed-returns-contracts";
import { verifyFiledReturnsDownloadTarget } from "../../src/connectors/gst/filed-returns-download-target";

const GSTR3B_TARGET: FiledReturnsDownloadTarget = {
  actionId: "synthetic-action",
  artifactType: "PDF",
  financialYear: "2026-27",
  period: "April",
  returnType: "GSTR-3B",
};

describe("verifyFiledReturnsDownloadTarget", () => {
  it("accepts the matching GSTR-3B detail identity despite surrounding decoy content", () => {
    const result = verifyFiledReturnsDownloadTarget(gstr3bDetailPage(), GSTR3B_TARGET, [
      "download-filed-gstr3b-visible",
    ]);

    expect(result).toBeNull();
  });

  it.each([
    {
      mismatch: "return type",
      target: { ...GSTR3B_TARGET, returnType: "GSTR-1" as const },
      visibleSignal: "filed-return-detail-type:GSTR-3B",
    },
    {
      mismatch: "tax period",
      target: { ...GSTR3B_TARGET, period: "May" },
      visibleSignal: "filed-return-detail-period:April",
    },
    {
      mismatch: "financial year",
      target: { ...GSTR3B_TARGET, financialYear: "2025-26" },
      visibleSignal: "filed-return-detail-financial-year:2026-27",
    },
  ])(
    "blocks a GSTR-3B detail $mismatch mismatch with safe signals",
    ({ target, visibleSignal }) => {
      const result = verifyFiledReturnsDownloadTarget(gstr3bDetailPage(), target, [
        "download-filed-gstr3b-visible",
      ]);

      expect(result).toMatchObject({
        connectorId: "gst",
        state: "blocked",
        safeMessage: expect.stringMatching(/will not click/i),
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          canResume: true,
        },
      });
      expect(result?.safeSignals).toEqual(
        expect.arrayContaining([
          "download-filed-gstr3b-visible",
          visibleSignal,
          "filed-return-download-target-mismatch",
        ]),
      );
      expect(result?.safeSignals.join(" ")).not.toMatch(
        /00XXXXX0000X0Z0|synthetic taxpayer|synthetic traders/i,
      );
    },
  );

  it("adds the target-mismatch signal when the GSTR-2B summary scope guard blocks", () => {
    const documentRef = new JSDOM(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>Financial Year - 2026-27</p>
          <p>Return Period - April</p>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      { url: "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary" },
    ).window.document;

    const result = verifyFiledReturnsDownloadTarget(
      documentRef,
      {
        actionId: "synthetic-gstr2b-action",
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      },
      ["download-filed-gstr2b-visible"],
    );

    expect(result).toMatchObject({
      connectorId: "gst",
      state: "blocked",
      safeMessage: expect.stringMatching(/could not verify/i),
    });
    expect(result?.safeSignals).toEqual(
      expect.arrayContaining([
        "download-filed-gstr2b-visible",
        "gstr2b-visible-period-mismatch",
        "filed-return-download-target-mismatch",
      ]),
    );
  });
});

function gstr3bDetailPage(): Document {
  return new JSDOM(
    `
      <main>
        <aside>GSTR-3B table</aside>
        <section aria-label="Filed return detail">
          <p>GSTIN - 00XXXXX0000X0Z0</p>
          <p>Legal Name - Synthetic Taxpayer Private Limited</p>
          <p>Trade Name - Synthetic Traders</p>
          <header>
            <span>FY - 2026-27</span>
            <span>Tax Period - April</span>
            <span>Status - Filed</span>
          </header>
          <button>Download Filed GSTR-3B</button>
        </section>
      </main>
    `,
    { url: "https://return.gst.gov.in/returns/auth/gstr3b" },
  ).window.document;
}
