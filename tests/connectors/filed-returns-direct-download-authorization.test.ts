import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { authorizeFiledGstr3bDirectDownload } from "../../src/connectors/gst/filed-returns-direct-download-authorization";

const TARGET = {
  actionId: "00000000-0000-4000-8000-000000000001",
  artifactType: "PDF" as const,
  financialYear: "2026-27",
  period: "April",
  returnType: "GSTR-3B" as const,
};

describe("filed GSTR-3B direct download authorization", () => {
  it("authorizes only the matching visible filed-return target", () => {
    const documentRef = new JSDOM(
      `<main>
        <h1>GSTR-3B - Monthly Return</h1>
        <p>Financial Year: 2026-27</p>
        <p>Return Period: April</p>
        <p>Status - Filed</p>
        <button>Download Filed GSTR-3B</button>
      </main>`,
      { url: "https://return.gst.gov.in/returns/auth/gstr3b" },
    ).window.document;

    expect(authorizeFiledGstr3bDirectDownload(documentRef, TARGET)).toMatchObject({
      ok: true,
      ready: {
        actionId: TARGET.actionId,
        safeSignals: expect.arrayContaining(["filed-gstr3b-direct-download-authorized"]),
      },
    });
  });

  it("rejects a page whose visible period differs from the requested target", () => {
    const documentRef = new JSDOM(
      `<main>
        <h1>GSTR-3B - Monthly Return</h1>
        <p>Financial Year: 2026-27</p>
        <p>Return Period: May</p>
        <p>Status - Filed</p>
        <button>Download Filed GSTR-3B</button>
      </main>`,
      { url: "https://return.gst.gov.in/returns/auth/gstr3b" },
    ).window.document;

    expect(authorizeFiledGstr3bDirectDownload(documentRef, TARGET)).toMatchObject({
      ok: false,
      downloadTrigger: {
        state: "blocked",
        safeSignals: expect.arrayContaining(["filed-return-download-target-mismatch"]),
      },
    });
  });
});
