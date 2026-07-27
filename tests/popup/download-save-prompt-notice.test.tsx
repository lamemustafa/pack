import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import {
  DownloadSavePromptNotice,
  shouldShowDownloadSavePromptNotice,
} from "../../src/entrypoints/popup/download-save-prompt-notice";

const observedSummary: FiledReturnsFlowSummary = {
  scope: { financialYear: "2026-27", period: "June", returnType: "GSTR-3B" },
  status: "complete",
  completedPeriods: ["June"],
  currentPeriod: "June",
  totalPeriods: 1,
  flowStep: {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "downloaded",
    safeSignals: ["download-save-prompt-observed"],
    safeMessage: "Saved.",
  },
};

describe("download save-prompt notice", () => {
  it("shows only after an observed empty-filename download and until dismissed", () => {
    expect(shouldShowDownloadSavePromptNotice(observedSummary, false)).toBe(true);
    expect(shouldShowDownloadSavePromptNotice(observedSummary, true)).toBe(false);
    expect(
      shouldShowDownloadSavePromptNotice(
        { ...observedSummary, flowStep: { ...observedSummary.flowStep, safeSignals: [] } },
        false,
      ),
    ).toBe(false);
  });

  it("describes the observed browser wait without claiming Pack changes settings", () => {
    const markup = renderToStaticMarkup(<DownloadSavePromptNotice onDismiss={vi.fn()} />);

    expect(markup).toContain("last download waited for a save location");
    expect(markup).toContain("Pack cannot override it");
    expect(markup).toContain("unattended runs");
    expect(markup).not.toContain("Pack disables");
  });
});
