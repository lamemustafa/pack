import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/core/contracts";
import { SinglePeriodReceipt } from "../../src/entrypoints/popup/single-period-receipt";

const summary: FiledReturnsFlowSummary = {
  scope: { artifactType: "PDF", financialYear: "2025-26", period: "May", returnType: "GSTR-3B" },
  status: "complete",
  completedAt: "2026-07-21T01:02:03.000Z",
  completedPeriods: ["May"],
  totalPeriods: 1,
  flowStep: {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "downloaded",
    safeSignals: ["browser-download-non-empty"],
    safeMessage: "Verified.",
  },
};

describe("single-period receipt", () => {
  it("shows only a verified direct-download receipt and an explicit local export", () => {
    const markup = renderToStaticMarkup(
      <SinglePeriodReceipt
        busy={false}
        downloadStatus={null}
        onDownload={vi.fn()}
        summary={summary}
      />,
    );

    expect(markup).toContain("Verified single-period download");
    expect(markup).toContain("Download receipt (.json)");
    expect(markup).toContain("does not contain portal content, account information");
    expect(markup).not.toContain("GSTIN");
  });

  it("does not show a receipt for an unresolved result", () => {
    const markup = renderToStaticMarkup(
      <SinglePeriodReceipt
        busy={false}
        downloadStatus={null}
        onDownload={vi.fn()}
        summary={{ ...summary, status: "blocked" }}
      />,
    );

    expect(markup).toBe("");
  });
});
