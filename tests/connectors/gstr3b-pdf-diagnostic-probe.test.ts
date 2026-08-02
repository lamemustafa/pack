import { describe, expect, it } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { gstr3bPdfDiagnosticProbe } from "../../src/connectors/gst/gstr3b-pdf-diagnostic-probe";

const sensitiveSummary: FiledReturnsFlowSummary = {
  scope: {
    financialYear: "sensitive-financial-year",
    period: "sensitive-period",
    returnType: "GSTR-3B",
  },
  status: "complete",
  completedPeriods: ["sensitive-period"],
  totalPeriods: 1,
  currentPeriod: "sensitive-period",
  artifactAcquisitionCompletion: [
    { artifactType: "PDF", downloadId: 71, requestId: "sensitive-request-id" },
  ],
  flowStep: {
    connectorId: "gst",
    scopeId: "sensitive-scope-id",
    state: "downloaded",
    safeSignals: ["sensitive-signal"],
    safeMessage: "Sensitive message.",
    downloadDiagnostic: {
      schemaVersion: "1.0",
      eventType: "filed-return-download-path",
      actionId: "sensitive-action-id",
      returnType: "GSTR-3B",
      financialYear: "sensitive-financial-year",
      period: "sensitive-period",
      endpointClass: "gstr3b-portal-rendered-download",
      artifactType: "PDF",
      downloadPathClass: "portal-click-blob",
      downloadId: 71,
      status: "downloaded",
    },
  },
};

describe("GSTR-3B PDF diagnostic probe", () => {
  it("returns only fixed confirmed evidence without source fields", () => {
    const probe = gstr3bPdfDiagnosticProbe(sensitiveSummary);

    expect(probe).toEqual({
      attempt: "present",
      outcome: "confirmed",
      reasonClass: "exact-download-confirmed",
      evidence: {
        exactDownloadObserved: true,
        terminalComplete: true,
        nonEmpty: true,
        browserSafe: true,
      },
    });

    const renderedProbe = JSON.stringify(probe);
    for (const forbiddenValue of [
      "sensitive-financial-year",
      "sensitive-period",
      "sensitive-request-id",
      "sensitive-scope-id",
      "sensitive-signal",
      "Sensitive message.",
      "sensitive-action-id",
      "71",
    ]) {
      expect(renderedProbe).not.toContain(forbiddenValue);
    }
  });

  it("does not disclose a different return type", () => {
    expect(
      gstr3bPdfDiagnosticProbe({
        ...sensitiveSummary,
        scope: { ...sensitiveSummary.scope, returnType: "GSTR-1" },
      }),
    ).toEqual({
      attempt: "absent",
      outcome: "unconfirmed",
      reasonClass: "no-matching-gstr3b-pdf-attempt",
      evidence: {
        exactDownloadObserved: false,
        terminalComplete: false,
        nonEmpty: false,
        browserSafe: false,
      },
    });
  });
});
