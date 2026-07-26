import { describe, expect, it } from "vitest";
import { withFiledReturnsDownloadDiagnostic } from "../../src/background/filed-returns-download-diagnostics";

describe("filed-return download diagnostics", () => {
  it("retains browser download id zero as exact completion evidence", () => {
    const result = withFiledReturnsDownloadDiagnostic({
      attemptClass: "portal-click",
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded",
        safeSignals: ["browser-download-completed", "browser-download-non-empty"],
        safeMessage: "The target download completed.",
      },
      safeEvidence: {
        downloadId: 0,
        urlClass: "https",
        mimeClass: "pdf",
        byteCountClass: "non-empty",
      },
      target: {
        actionId: "00000000-0000-4000-8000-000000000001",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-3B",
        artifactType: "PDF",
      },
    });

    expect(result.downloadDiagnostic?.downloadId).toBe(0);
  });
});
