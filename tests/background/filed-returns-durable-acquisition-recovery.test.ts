import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const read = (values: Record<string, unknown>, keys?: string | string[]) => {
    if (keys === undefined) return { ...values };
    return Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys]).map((key) => [key, values[key]]),
    );
  };
  const remove = (values: Record<string, unknown>, keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
  };
  return {
    browser: {
      downloads: { search: vi.fn() },
      storage: {
        local: {
          get: vi.fn(async (keys?: string | string[]) => read(local, keys)),
          remove: vi.fn(async (keys: string | string[]) => remove(local, keys)),
          set: vi.fn(async (values: Record<string, unknown>) => Object.assign(local, values)),
        },
        session: {
          clear: vi.fn(async () => {
            for (const key of Object.keys(session)) delete session[key];
          }),
          get: vi.fn(async (keys?: string | string[]) => read(session, keys)),
          remove: vi.fn(async (keys: string | string[]) => remove(session, keys)),
          set: vi.fn(async (values: Record<string, unknown>) => Object.assign(session, values)),
        },
      },
    },
    local,
    session,
  };
});

vi.mock("wxt/browser", () => ({ browser: mocks.browser }));

import {
  artifactAcquisitionCheckpointKey,
  persistArtifactAcquisitionDownloadId,
  reconcileArtifactAcquisitionCheckpoint,
} from "../../src/background/artifact-acquisition-state";
import { reconcileTerminalFiledReturnsDownload } from "../../src/background/filed-returns-durable-download-reconciler";
import { clearPackLocalDataWithRecoveryGuard } from "../../src/background/local-data";
import { startSinglePeriodFiledReturnsDownloadFlow } from "../../src/background/filed-returns-single-period-flow";
import { resolveUnconfirmedFiledReturnsDownload } from "../../src/background/filed-returns-target-review";
const completionKey = "pack:last-filed-returns-flow-summary";
const targetReviewKey = "pack:filed-returns-target-review";
const activeRunKey = "pack:active-filed-returns-run";
const target = {
  artifactType: "PDF" as const,
  financialYear: "2026-27",
  period: "May",
  returnType: "GSTR-3B" as const,
};
const requestId = "00000000-0000-4000-8000-000000000001";
const juneTarget = { ...target, period: "June" };
const juneRequestId = "00000000-0000-4000-8000-000000000002";

function durableDeps() {
  return {
    storageKeys: {
      activeRun: activeRunKey,
      completion: completionKey,
      targetReview: targetReviewKey,
    },
  };
}

function completedDownload(downloadId = 231, artifactType: "PDF" | "EXCEL" = "PDF") {
  return {
    danger: "safe",
    fileSize: 40_108,
    id: downloadId,
    mime:
      artifactType === "PDF"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    startTime: new Date(Date.now() + 1_000).toISOString(),
    state: "complete",
  };
}

describe("durable acquisition checkpoint recovery", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.local)) delete mocks.local[key];
    for (const key of Object.keys(mocks.session)) delete mocks.session[key];
    vi.clearAllMocks();
  });

  it("leaves an acquisition checkpoint untouched for the next-run guard to surface", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...target,
      downloadId: 231,
      requestId,
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([{ id: 231, state: "in_progress" }]);
    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).resolves.toBe(false);
    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toMatchObject({
      downloadId: 231,
      state: "download-observing",
    });
    expect(mocks.local[targetReviewKey]).toBeUndefined();

    await expect(reconcileArtifactAcquisitionCheckpoint(target)).resolves.toEqual({
      safeSignals: ["artifact-acquisition-download-unreconciled"],
      state: "needs-review",
    });
  });

  it.each([
    ["correlation mismatch", { mime: "text/plain" }, "browser-download-correlation-rejected"],
    ["danger unknown", { danger: undefined }, "browser-download-danger-unknown"],
    ["danger pending", { danger: "asyncScanning" }, "browser-download-danger-pending"],
    ["zero bytes", { fileSize: 0 }, "browser-download-zero-bytes"],
  ] as const)(
    "makes a %s checkpoint rejection cancellable through the existing target review",
    async (_label, observationOverrides, expectedSignal) => {
      await persistArtifactAcquisitionDownloadId({
        ...target,
        downloadId: 231,
        requestId,
        state: "download-observing",
      });
      mocks.browser.downloads.search.mockResolvedValue([
        { ...completedDownload(), ...observationOverrides },
      ]);

      const response = await startSinglePeriodFiledReturnsDownloadFlow(
        target,
        durableDeps() as never,
      );

      expect(response).toMatchObject({
        flowStep: {
          safeSignals: expect.arrayContaining([
            "artifact-acquisition-download-unreconciled",
            expectedSignal,
          ]),
          state: "user-action-required",
        },
      });
      expect(mocks.local[targetReviewKey]).toMatchObject({
        safeSignals: expect.arrayContaining([
          "artifact-acquisition-download-unreconciled",
          expectedSignal,
        ]),
      });

      mocks.browser.downloads.search.mockResolvedValue([{ id: 231, state: "interrupted" }]);
      await expect(
        resolveUnconfirmedFiledReturnsDownload(target, "cancelled", durableDeps()),
      ).resolves.toMatchObject({ flowSummary: { status: "cancelled" } });
      expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toBeUndefined();
      expect(mocks.local[targetReviewKey]).toBeUndefined();

      await expect(
        clearPackLocalDataWithRecoveryGuard({
          clearableLocalStorageKeys: [],
          storageKeys: {
            activeRun: activeRunKey,
            fullFiscalYearLedger: "pack:full-fiscal-year-ledger",
            targetReview: targetReviewKey,
          },
        }),
      ).resolves.toEqual({ cleared: true, ok: true });
    },
  );

  it("does not complete a checkpoint whose record does not own its target", async () => {
    const key = artifactAcquisitionCheckpointKey(target);
    mocks.session[key] = {
      ...target,
      armedAt: new Date().toISOString(),
      downloadId: 231,
      period: "April",
      requestId,
      state: "download-observing",
    };
    mocks.browser.downloads.search.mockResolvedValue([completedDownload()]);

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).resolves.toBe(false);

    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
    expect(mocks.session[key]).toMatchObject({ period: "April" });
    expect(mocks.session[completionKey]).toBeUndefined();
    expect(mocks.local[targetReviewKey]).toBeUndefined();
  });

  it("retains every completed checkpoint across repeated global scans", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...target,
      downloadId: 231,
      requestId,
      state: "download-observing",
    });
    await persistArtifactAcquisitionDownloadId({
      ...juneTarget,
      downloadId: 232,
      requestId: juneRequestId,
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockImplementation(async ({ id }) => [completedDownload(id)]);
    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).resolves.toBe(false);

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).resolves.toBe(false);

    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
    expect(mocks.session[completionKey]).toBeUndefined();
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toMatchObject({
      downloadId: 231,
      requestId,
    });
    expect(mocks.session[artifactAcquisitionCheckpointKey(juneTarget)]).toMatchObject({
      downloadId: 232,
      requestId: juneRequestId,
    });
  });
});
