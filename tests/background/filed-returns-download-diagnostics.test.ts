import { describe, expect, it } from "vitest";
import { isFiledReturnsEndpointClassForArtifact } from "../../src/connectors/gst/filed-returns-download-diagnostic-compatibility";
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

  it("labels a GSTR-3B JSON MAIN-world capture precisely and rejects PDF-only paths", () => {
    const result = withFiledReturnsDownloadDiagnostic({
      attemptClass: "captured-portal-request",
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded",
        safeSignals: ["target-period-verified"],
        safeMessage: "The target download completed.",
      },
      safeEvidence: {
        downloadId: 3,
        urlClass: "unknown",
        mimeClass: "json",
        byteCountClass: "non-empty",
      },
      target: {
        actionId: "00000000-0000-4000-8000-000000000003",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-3B",
        artifactType: "JSON",
      },
    });

    expect(result.downloadDiagnostic?.endpointClass).toBe(
      "gstr3b-main-world-json-captured-download",
    );
    expect(
      isFiledReturnsEndpointClassForArtifact(
        "gstr3b-main-world-json-captured-download",
        "GSTR-3B",
        "JSON",
      ),
    ).toBe(true);
    expect(
      isFiledReturnsEndpointClassForArtifact("gstr3b-portal-rendered-download", "GSTR-3B", "JSON"),
    ).toBe(false);
    expect(
      isFiledReturnsEndpointClassForArtifact(
        "gstr3b-browser-managed-direct-download",
        "GSTR-3B",
        "JSON",
      ),
    ).toBe(false);
  });

  it("accepts GSTR-2B JSON only through its MAIN-world capture class", () => {
    expect(
      isFiledReturnsEndpointClassForArtifact(
        "gstr2b-main-world-json-captured-download",
        "GSTR-2B",
        "JSON",
      ),
    ).toBe(true);
    expect(
      isFiledReturnsEndpointClassForArtifact(
        "gstr2b-portal-blob-captured-download",
        "GSTR-2B",
        "JSON",
      ),
    ).toBe(false);
    expect(
      isFiledReturnsEndpointClassForArtifact(
        "filed-return-portal-rendered-download",
        "GSTR-2B",
        "JSON",
      ),
    ).toBe(false);
  });
});
