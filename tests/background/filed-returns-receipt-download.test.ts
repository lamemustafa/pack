import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/core/contracts";

const browserMocks = vi.hoisted(() => ({
  download: vi.fn(async () => 731),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    downloads: {
      download: browserMocks.download,
    },
  },
}));

import { exportCompletedSinglePeriodReceipt } from "../../src/background/filed-returns-receipt-download";

const scope = {
  artifactType: "PDF" as const,
  financialYear: "2025-26",
  period: "May",
  returnType: "GSTR-3B" as const,
};

const completeSummary: FiledReturnsFlowSummary = {
  scope,
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

describe("single-period receipt export", () => {
  beforeEach(() => {
    browserMocks.download.mockClear();
  });

  it("requests only an allow-listed local JSON receipt after verified completion", async () => {
    const result = await exportCompletedSinglePeriodReceipt(scope, completeSummary);

    expect(result).toMatchObject({ ok: true, receipt: { targets: [{ status: "verified" }] } });
    expect(browserMocks.download).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "ComplyEaze-Pack/Receipts/gstr-3b-2025-26-may-receipt.json",
      saveAs: false,
      url: expect.stringMatching(/^data:application\/json;charset=utf-8,/),
    });
    const url = browserMocks.download.mock.calls[0]?.[0].url as string;
    const receipt = JSON.parse(decodeURIComponent(url.slice(url.indexOf(",") + 1)));
    expect(Object.keys(receipt)).toEqual([
      "schemaVersion",
      "createdAt",
      "archiveScope",
      "returnType",
      "financialYear",
      "artifactTypes",
      "targetCount",
      "artifactCount",
      "targets",
    ]);
    expect(JSON.stringify(receipt)).not.toMatch(/gstin|pan|arn|filename|path|portal/i);
  });

  it("rejects a receipt request that is not backed by a verified matching summary", async () => {
    const result = await exportCompletedSinglePeriodReceipt(scope, {
      ...completeSummary,
      status: "blocked",
    });

    expect(result).toEqual({
      ok: false,
      error:
        "A local receipt is available only after Pack verifies this selected single-period download.",
    });
    expect(browserMocks.download).not.toHaveBeenCalled();
  });

  it.each([
    ["missing completion time", { ...completeSummary, completedAt: undefined }],
    [
      "unverified flow step",
      {
        ...completeSummary,
        flowStep: { ...completeSummary.flowStep, state: "download-unconfirmed" as const },
      },
    ],
    [
      "different artifact selection",
      {
        ...completeSummary,
        scope: { ...scope, artifactType: "PDF_AND_EXCEL" as const },
      },
    ],
  ])("rejects %s", async (_reason, summary) => {
    const result = await exportCompletedSinglePeriodReceipt(scope, summary);

    expect(result.ok).toBe(false);
    expect(browserMocks.download).not.toHaveBeenCalled();
  });
});
