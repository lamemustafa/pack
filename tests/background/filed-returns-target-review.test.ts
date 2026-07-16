import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  persistFiledReturnsTargetReview,
  resolveUnconfirmedFiledReturnsDownload,
} from "../../src/background/filed-returns-target-review";

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async (_key?: unknown): Promise<Record<string, unknown>> => {
        void _key;
        return {};
      }),
      remove: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
    session: {
      set: vi.fn(async () => undefined),
    },
  },
}));

vi.mock("wxt/browser", () => ({
  browser: browserMocks,
}));

describe("filed returns target review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists a manual target-review resolution over the previous blocked summary", async () => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "target-review"
        ? {
            [key]: {
              schemaVersion: "1.0",
              targetId: "GSTR-3B:2025-26:March",
              status: "download-unconfirmed",
              scope: {
                financialYear: "2025-26",
                period: "March",
                returnType: "GSTR-3B",
              },
              safeSignals: ["browser-download-not-observed"],
              safeMessage: "No browser completion.",
              updatedAt: "2026-06-24T00:00:00.000Z",
            },
          }
        : {},
    );

    const response = await resolveUnconfirmedFiledReturnsDownload(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      "downloaded",
      {
        storageKeys: {
          completion: "completion",
          targetReview: "target-review",
        },
        now: () => new Date("2026-06-24T00:00:05.000Z"),
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowSummary: {
        status: "complete",
        completedPeriods: ["March"],
        totalPeriods: 1,
        updatedAt: "2026-06-24T00:00:05.000Z",
      },
    });
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith("target-review");
    expect(browserMocks.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        status: "complete",
        completedPeriods: ["March"],
        totalPeriods: 1,
        flowStep: expect.objectContaining({
          safeSignals: ["filed-returns-target-manually-confirmed"],
        }),
      }),
    });
  });

  it("does not persist optional GSTR-1 Excel no-details as a timeout review", async () => {
    const summary = await persistFiledReturnsTargetReview(
      {
        artifactType: "EXCEL",
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-1",
      },
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "blocked",
        safeSignals: [
          "filed-gstr1-main-world-capture-timeout",
          "filed-gstr1-excel-no-details-available",
        ],
        safeMessage: "No e-invoice details are available.",
      },
      { storageKeys: { completion: "completion", targetReview: "target-review" } },
    );

    expect(summary).toBeNull();
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });

  it("does not let manual review hide retained single-period staging", async () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-2B" as const,
    };
    const review = {
      schemaVersion: "1.0",
      targetId: "GSTR-2B:2025-26:March:PDF_AND_EXCEL",
      status: "download-unconfirmed",
      scope,
      safeSignals: ["single-period-zip-download-unconfirmed", "single-period-opfs-clear-failed"],
      safeMessage: "The ZIP download was unconfirmed and staging cleanup failed.",
      updatedAt: "2026-06-24T00:00:00.000Z",
    };
    browserMocks.storage.local.get.mockResolvedValue({ "target-review": review });

    const response = await resolveUnconfirmedFiledReturnsDownload(scope, "downloaded", {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: ["single-period-opfs-clear-failed", "single-period-opfs-cleanup-required"],
      },
      flowSummary: { status: "blocked", completedPeriods: [] },
    });
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
    expect(browserMocks.storage.session.set).not.toHaveBeenCalled();
  });

  it("does not mark an incomplete selected-file ZIP complete manually", async () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-2B" as const,
    };
    browserMocks.storage.local.get.mockResolvedValue({
      "target-review": {
        schemaVersion: "1.0",
        targetId: "GSTR-2B:2025-26:March:PDF_AND_EXCEL",
        status: "download-unconfirmed",
        scope,
        safeSignals: ["gstr2b-main-world-capture-timeout", "single-period-zip-incomplete"],
        safeMessage: "The selected-file ZIP is incomplete.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });

    const response = await resolveUnconfirmedFiledReturnsDownload(scope, "downloaded", {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        safeSignals: ["filed-returns-target-review-required", "single-period-zip-incomplete"],
        state: "user-action-required",
      },
      flowSummary: { status: "blocked" },
    });
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
    expect(browserMocks.storage.session.set).not.toHaveBeenCalled();
  });

  it("persists a cleanup-only target review for a cleanup-failed ZIP", async () => {
    const summary = await persistFiledReturnsTargetReview(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-2B",
      },
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
        state: "download-unconfirmed",
        safeSignals: ["single-period-zip-download-unconfirmed", "single-period-opfs-clear-failed"],
        safeMessage: "Cleanup failed.",
      },
      { storageKeys: { targetReview: "target-review" } },
    );

    expect(summary).toMatchObject({
      status: "blocked",
      flowStep: {
        safeSignals: ["single-period-opfs-clear-failed", "single-period-opfs-cleanup-required"],
      },
    });
    expect(browserMocks.storage.local.set).toHaveBeenCalledWith({
      "target-review": expect.objectContaining({
        safeSignals: expect.arrayContaining(["single-period-opfs-clear-failed"]),
      }),
    });
  });
});
