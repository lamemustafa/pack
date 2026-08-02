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
import { filedReturnScopeId } from "../../src/connectors/gst/filed-returns-return-descriptors";
import { persistFiledReturnsTargetReview } from "../../src/background/filed-returns-target-review";

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

function durableDeps() {
  return {
    storageKeys: {
      activeRun: activeRunKey,
      completion: completionKey,
      targetReview: targetReviewKey,
    },
  };
}

function persistActiveRun(): void {
  mocks.local[activeRunKey] = {
    leaseUpdatedAt: new Date().toISOString(),
    revision: 1,
    runId: "filed-returns-run-m0abc123",
    schemaVersion: "1.0",
    scope: target,
    status: "running",
  };
}

function completedDownload(downloadId = 231) {
  return {
    danger: "safe",
    fileSize: 40_108,
    id: downloadId,
    mime: "application/pdf",
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
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toMatchObject({
      downloadId: 231,
      requestId,
    });
    expect(mocks.local[targetReviewKey]).toMatchObject({
      artifactAcquisitionCompletion: [{ artifactType: "PDF", downloadId: 231, requestId }],
    });
  });

  it("retains the proved checkpoint for the next-run guard when summary persistence fails", async () => {
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
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toMatchObject({
      downloadId: 231,
      requestId,
    });
    await expect(reconcileArtifactAcquisitionCheckpoint(target)).resolves.toEqual({
      safeSignals: ["artifact-acquisition-download-completed-unpersisted"],
      state: "needs-review",
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
});
