import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveUnconfirmedFiledReturnsDownload } from "../../src/background/filed-returns-target-review";

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
});
