import { describe, expect, it } from "vitest";
import { withArtifactDownloadMessage } from "../../src/background/filed-returns-download-result";

describe("filed-return download result copy", () => {
  it("labels a completed GSTR-2B workbook as Details (Excel)", () => {
    const result = withArtifactDownloadMessage(
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr2b-private-v0",
        state: "downloaded",
        safeSignals: ["filed-return-artifact-downloaded:EXCEL"],
        safeMessage: "Downloaded.",
      },
      {
        artifactType: "EXCEL",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      },
      "EXCEL",
    );

    expect(result.safeMessage).toBe(
      "The browser reported that the filed-return Details (Excel) download completed. Check the local downloads folder for the GST Portal file.",
    );
    expect(result.safeMessage).not.toContain("e-invoice");
  });
});
