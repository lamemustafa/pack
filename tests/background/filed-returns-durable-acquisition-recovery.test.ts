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
import { filedReturnScopeId } from "../../src/connectors/gst/filed-returns-return-descriptors";
import {
  artifactAcquisitionCompletionMarkerKey,
  persistArtifactAcquisitionCompletionMarker,
  persistFiledReturnsTargetReview,
  readArtifactAcquisitionCompletionMarker,
  resolveUnconfirmedFiledReturnsDownload,
} from "../../src/background/filed-returns-target-review";
import type { FiledReturnsDownloadScope } from "../../src/connectors/gst/filed-returns-contracts";

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

function persistActiveRun(
  scope: FiledReturnsDownloadScope = target,
  runId = "filed-returns-run-m0abc123",
): void {
  mocks.local[activeRunKey] = {
    leaseUpdatedAt: new Date().toISOString(),
    revision: 1,
    runId,
    schemaVersion: "1.0",
    scope,
    status: "running",
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

  it("persists a proved completion and clears its checkpoint after a worker restart", async () => {
    persistActiveRun();
    await persistArtifactAcquisitionDownloadId({
      ...target,
      downloadId: 231,
      requestId,
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([completedDownload()]);

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).resolves.toBe(true);

    expect(mocks.session[completionKey]).toMatchObject({
      artifactAcquisitionCompletion: [{ artifactType: "PDF", downloadId: 231, requestId }],
      status: "complete",
    });
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toBeUndefined();
    expect(mocks.local[activeRunKey]).toBeUndefined();
    expect(mocks.local[targetReviewKey]).toBeUndefined();
    await expect(
      readArtifactAcquisitionCompletionMarker(target, durableDeps()),
    ).resolves.toMatchObject({
      artifactAcquisitionCompletion: [{ artifactType: "PDF", downloadId: 231, requestId }],
    });
  });

  it("leaves an in-progress checkpoint untouched for the next-run guard to surface", async () => {
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

  it("does not downgrade a proved completion when checkpoint cleanup is interrupted", async () => {
    persistActiveRun();
    await persistFiledReturnsTargetReview(
      target,
      {
        connectorId: "gst",
        scopeId: filedReturnScopeId(target.returnType),
        state: "blocked",
        safeMessage: "Pack retained unresolved artifact download recovery.",
        safeSignals: ["artifact-acquisition-download-unreconciled"],
        userAction: {
          canResume: true,
          message: "Review or cancel this target before starting another portal action.",
          type: "RETRY_PORTAL_GENERATION",
        },
      },
      durableDeps(),
    );
    await persistArtifactAcquisitionDownloadId({
      ...target,
      downloadId: 231,
      requestId,
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([completedDownload()]);
    mocks.browser.storage.session.remove.mockRejectedValueOnce(
      new Error("Synthetic worker stop before checkpoint cleanup."),
    );

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).rejects.toThrow("Synthetic worker stop before checkpoint cleanup.");

    expect(mocks.session[completionKey]).toMatchObject({ status: "complete" });
    expect(mocks.local[activeRunKey]).toBeUndefined();
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toMatchObject({
      downloadId: 231,
      requestId,
    });
    expect(
      mocks.local[artifactAcquisitionCompletionMarkerKey(targetReviewKey, target)],
    ).toMatchObject({
      artifactAcquisitionCompletion: [{ artifactType: "PDF", downloadId: 231, requestId }],
    });
    expect(mocks.local[targetReviewKey]).toMatchObject({
      artifactAcquisitionCompletion: [{ artifactType: "PDF", downloadId: 231, requestId }],
    });
  });

  it("keeps durable proof when session summary persistence is interrupted", async () => {
    persistActiveRun();
    await persistArtifactAcquisitionDownloadId({
      ...target,
      downloadId: 231,
      requestId,
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([completedDownload()]);
    mocks.browser.storage.session.set.mockRejectedValueOnce(
      new Error("Synthetic worker stop before summary persistence."),
    );

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).rejects.toThrow("Synthetic worker stop before summary persistence.");

    expect(mocks.session[completionKey]).toBeUndefined();
    expect(mocks.local[activeRunKey]).toBeUndefined();
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toMatchObject({
      downloadId: 231,
      requestId,
    });
    for (const key of Object.keys(mocks.session)) delete mocks.session[key];
    await expect(
      readArtifactAcquisitionCompletionMarker(target, durableDeps()),
    ).resolves.toMatchObject({
      artifactAcquisitionCompletion: [{ artifactType: "PDF", downloadId: 231, requestId }],
    });
  });

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

  it("keeps two proved targets in separate durable completion markers", async () => {
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
    ).resolves.toBe(true);

    expect(
      mocks.local[artifactAcquisitionCompletionMarkerKey(targetReviewKey, target)],
    ).toMatchObject({
      artifactAcquisitionCompletion: [{ artifactType: "PDF", downloadId: 231, requestId }],
    });
    expect(
      mocks.local[artifactAcquisitionCompletionMarkerKey(targetReviewKey, juneTarget)],
    ).toMatchObject({
      artifactAcquisitionCompletion: [
        { artifactType: "PDF", downloadId: 232, requestId: juneRequestId },
      ],
    });
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toBeUndefined();
    expect(mocks.session[artifactAcquisitionCheckpointKey(juneTarget)]).toBeUndefined();
  });

  it("does not clear a checkpoint when its durable completion marker cannot be written", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...target,
      downloadId: 231,
      requestId,
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([completedDownload()]);
    mocks.browser.storage.local.set.mockRejectedValueOnce(
      new Error("Synthetic local storage failure."),
    );

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).rejects.toThrow("Synthetic local storage failure.");

    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toMatchObject({
      downloadId: 231,
      requestId,
    });
    await expect(
      readArtifactAcquisitionCompletionMarker(target, durableDeps()),
    ).resolves.toBeNull();
  });

  it("retains durable proof and a replacement same-scope lease across a recovery race", async () => {
    persistActiveRun();
    await persistArtifactAcquisitionDownloadId({
      ...target,
      downloadId: 231,
      requestId,
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockImplementation(async () => {
      // The scanner already captured the old lease before it asks Chrome for
      // completion proof. A newly acquired same-scope lease must survive.
      persistActiveRun(target, "filed-returns-run-rpl12345");
      return [completedDownload()];
    });

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).resolves.toBe(true);

    expect(mocks.local[activeRunKey]).toMatchObject({ runId: "filed-returns-run-rpl12345" });
    await expect(
      readArtifactAcquisitionCompletionMarker(target, durableDeps()),
    ).resolves.toMatchObject({
      artifactAcquisitionCompletion: [{ artifactType: "PDF", downloadId: 231, requestId }],
    });
  });

  it("releases a composite lease only after every selected artifact has durable proof", async () => {
    const gstr2bPdfTarget = { ...target, returnType: "GSTR-2B" as const };
    const gstr2bExcelTarget = { ...gstr2bPdfTarget, artifactType: "EXCEL" as const };
    const gstr2bCompositeScope = {
      ...gstr2bPdfTarget,
      artifactType: "PDF_AND_EXCEL" as const,
    };
    persistActiveRun(gstr2bCompositeScope);
    await persistArtifactAcquisitionDownloadId({
      ...gstr2bPdfTarget,
      downloadId: 231,
      requestId,
      state: "download-observing",
    });
    await persistArtifactAcquisitionDownloadId({
      ...gstr2bExcelTarget,
      downloadId: 232,
      requestId: juneRequestId,
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockImplementation(async ({ id }) => [
      completedDownload(id, id === 232 ? "EXCEL" : "PDF"),
    ]);

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).resolves.toBe(true);

    expect(mocks.local[activeRunKey]).toBeUndefined();
    await expect(
      readArtifactAcquisitionCompletionMarker(gstr2bExcelTarget, durableDeps()),
    ).resolves.toMatchObject({
      artifactAcquisitionCompletion: [{ artifactType: "EXCEL", downloadId: 232 }],
    });
  });

  it("does not clear a proved composite component when cancelling its unresolved selection", async () => {
    const gstr2bPdfTarget = { ...target, returnType: "GSTR-2B" as const };
    const gstr2bCompositeScope = {
      ...gstr2bPdfTarget,
      artifactType: "PDF_AND_EXCEL" as const,
    };
    await expect(
      persistArtifactAcquisitionCompletionMarker(
        gstr2bPdfTarget,
        [{ artifactType: "PDF", downloadId: 231, requestId }],
        durableDeps(),
      ),
    ).resolves.toMatchObject({ state: "persisted" });
    await persistFiledReturnsTargetReview(
      gstr2bCompositeScope,
      {
        connectorId: "gst",
        scopeId: filedReturnScopeId(gstr2bCompositeScope.returnType),
        state: "blocked",
        safeMessage: "Pack retained unresolved artifact download recovery.",
        safeSignals: ["artifact-acquisition-download-unreconciled"],
        userAction: {
          canResume: true,
          message: "Review or cancel this target before starting another portal action.",
          type: "RETRY_PORTAL_GENERATION",
        },
      },
      durableDeps(),
    );

    await expect(
      resolveUnconfirmedFiledReturnsDownload(gstr2bCompositeScope, "cancelled", durableDeps()),
    ).resolves.toMatchObject({
      flowStep: {
        safeMessage:
          "Pack cancelled the unproved artifact and retained the exact proof for the completed artifact. No portal action was retried.",
      },
      flowSummary: { status: "cancelled" },
    });

    await expect(
      readArtifactAcquisitionCompletionMarker(gstr2bPdfTarget, durableDeps()),
    ).resolves.toMatchObject({
      artifactAcquisitionCompletion: [{ artifactType: "PDF", downloadId: 231, requestId }],
    });
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
    ).resolves.toEqual({ ok: true, cleared: true });
  });
});
