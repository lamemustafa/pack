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
      runtime: { id: "pack-id" },
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
import { readCurrentFiledReturnsFlowSummary } from "../../src/background/filed-returns-current-state";
import { acquireFiledReturnsRun } from "../../src/background/filed-returns-active-run";
import { filedReturnScopeId } from "../../src/connectors/gst/filed-returns-return-descriptors";
import {
  persistFiledReturnsTargetReview,
  resolveUnconfirmedFiledReturnsDownload,
} from "../../src/background/filed-returns-target-review";

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

describe("durable acquisition checkpoint recovery", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.local)) delete mocks.local[key];
    for (const key of Object.keys(mocks.session)) delete mocks.session[key];
    vi.clearAllMocks();
  });

  it("persists a completion and clears its checkpoint after a worker restart, while an in-progress download remains reviewed", async () => {
    persistActiveRun();
    await persistArtifactAcquisitionDownloadId({
      ...target,
      downloadId: 231,
      requestId,
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([
      {
        danger: "safe",
        fileSize: 40_108,
        id: 231,
        mime: "application/pdf",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).resolves.toBe(true);

    expect(mocks.session[completionKey]).toMatchObject({
      artifactAcquisitionCompletion: [{ artifactType: "PDF", downloadId: 231, requestId }],
      status: "complete",
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining(["artifact-acquisition-download-reconciled"]),
      },
    });
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toBeUndefined();
    expect(mocks.local[activeRunKey]).toBeUndefined();

    await persistArtifactAcquisitionDownloadId({
      ...target,
      downloadId: 232,
      requestId: "00000000-0000-4000-8000-000000000002",
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([{ id: 232, state: "in_progress" }]);

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).resolves.toBe(true);

    expect(mocks.local[targetReviewKey]).toMatchObject({
      scope: target,
      safeSignals: ["artifact-acquisition-download-unreconciled"],
      status: "download-unconfirmed",
    });
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toMatchObject({
      downloadId: 232,
      state: "download-observing",
    });

    mocks.browser.downloads.search.mockResolvedValue([
      {
        danger: "safe",
        fileSize: 40_108,
        id: 232,
        mime: "application/pdf",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);
    await reconcileTerminalFiledReturnsDownload(
      { search: mocks.browser.downloads.search },
      durableDeps(),
    );

    expect(mocks.local[targetReviewKey]).toBeUndefined();
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toBeUndefined();
    expect(mocks.session[completionKey]).toMatchObject({
      artifactAcquisitionCompletion: [expect.objectContaining({ downloadId: 232 })],
      status: "complete",
    });
  });

  it("fails closed when a checkpoint under the target key embeds a different target", async () => {
    const key = artifactAcquisitionCheckpointKey(target);
    mocks.session[key] = {
      ...target,
      armedAt: new Date().toISOString(),
      artifactType: "PDF",
      downloadId: 231,
      period: "April",
      requestId,
      state: "download-observing",
    };

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).resolves.toBe(true);

    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
    expect(mocks.session[key]).toEqual({ schemaVersion: "1.0", state: "malformed" });
    expect(mocks.session[completionKey]).toBeUndefined();
    expect(mocks.local[targetReviewKey]).toMatchObject({
      safeSignals: ["artifact-acquisition-checkpoint-malformed"],
      status: "download-unconfirmed",
    });
  });

  it("fails closed on an unrecognised checkpoint state even when its download is otherwise safe", async () => {
    const key = artifactAcquisitionCheckpointKey(target);
    mocks.session[key] = {
      ...target,
      armedAt: new Date().toISOString(),
      downloadId: 231,
      requestId,
      state: "forward-version-state",
    };
    mocks.browser.downloads.search.mockResolvedValue([
      {
        danger: "safe",
        fileSize: 40_108,
        id: 231,
        mime: "application/pdf",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).resolves.toBe(true);

    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
    expect(mocks.session[key]).toEqual({ schemaVersion: "1.0", state: "malformed" });
    expect(mocks.session[completionKey]).toBeUndefined();
    expect(mocks.local[targetReviewKey]).toMatchObject({
      safeSignals: ["artifact-acquisition-checkpoint-malformed"],
      status: "download-unconfirmed",
    });
  });

  it("fails closed when a discovered checkpoint key decodes to a target but is not that target's canonical key", async () => {
    const canonicalKey = artifactAcquisitionCheckpointKey(target);
    const noncanonicalKey = canonicalKey.replace(".2026-27.", ".%32%30%32%36-27.");
    mocks.session[noncanonicalKey] = {
      ...target,
      armedAt: new Date().toISOString(),
      downloadId: 231,
      requestId,
      state: "download-observing",
    };

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).resolves.toBe(true);

    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
    expect(mocks.session[canonicalKey]).toBeUndefined();
    expect(mocks.session[noncanonicalKey]).toEqual({ schemaVersion: "1.0", state: "malformed" });
    expect(mocks.local[targetReviewKey]).toMatchObject({
      safeSignals: ["artifact-acquisition-checkpoint-malformed"],
      status: "download-unconfirmed",
    });
  });

  it("retains exact checkpoint ownership if the worker stops after resolving its active run but before summary persistence", async () => {
    persistActiveRun();
    await persistArtifactAcquisitionDownloadId({
      ...target,
      downloadId: 231,
      requestId,
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([
      {
        danger: "safe",
        fileSize: 40_108,
        id: 231,
        mime: "application/pdf",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);
    mocks.browser.storage.session.set.mockRejectedValueOnce(
      new Error("Synthetic worker stop before completion summary persistence."),
    );

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).rejects.toThrow("Synthetic worker stop before completion summary persistence.");

    expect(mocks.local[activeRunKey]).toBeUndefined();
    expect(mocks.session[completionKey]).toBeUndefined();
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toMatchObject({
      downloadId: 231,
      requestId,
    });
    expect(mocks.local[targetReviewKey]).toMatchObject({
      artifactAcquisitionCompletion: [{ artifactType: "PDF", downloadId: 231, requestId }],
      safeSignals: expect.arrayContaining(["artifact-acquisition-completion-pending-summary"]),
    });
    await expect(reconcileArtifactAcquisitionCheckpoint(target)).resolves.toEqual({
      safeSignals: ["artifact-acquisition-download-completed-unpersisted"],
      state: "needs-review",
    });
  });

  it("keeps every surviving record consistent if the worker stops after summary persistence but before checkpoint cleanup", async () => {
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
    mocks.browser.downloads.search.mockResolvedValue([
      {
        danger: "safe",
        fileSize: 40_108,
        id: 231,
        mime: "application/pdf",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);
    mocks.browser.storage.session.remove.mockRejectedValueOnce(
      new Error("Synthetic worker stop before checkpoint cleanup."),
    );

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).rejects.toThrow("Synthetic worker stop before checkpoint cleanup.");

    expect(mocks.local[activeRunKey]).toBeUndefined();
    expect(mocks.session[completionKey]).toMatchObject({ status: "complete" });
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toMatchObject({
      downloadId: 231,
      requestId,
    });
    expect(mocks.local[targetReviewKey]).toMatchObject({
      artifactAcquisitionCompletion: [{ artifactType: "PDF", downloadId: 231, requestId }],
    });
  });

  it("retains B's active lease and checkpoint when A's review cannot carry B's proved completion", async () => {
    const reviewScope = { ...target, period: "April" };
    await persistFiledReturnsTargetReview(
      reviewScope,
      {
        connectorId: "gst",
        scopeId: filedReturnScopeId(reviewScope.returnType),
        state: "blocked",
        safeMessage: "Pack retained A for review.",
        safeSignals: ["artifact-acquisition-download-unreconciled"],
        userAction: {
          canResume: true,
          message: "Review or cancel A before starting another portal action.",
          type: "RETRY_PORTAL_GENERATION",
        },
      },
      durableDeps(),
    );
    persistActiveRun();
    await persistArtifactAcquisitionDownloadId({
      ...target,
      downloadId: 231,
      requestId,
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([
      {
        danger: "safe",
        fileSize: 40_108,
        id: 231,
        mime: "application/pdf",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).resolves.toBe(true);

    expect(mocks.local[targetReviewKey]).toMatchObject({ scope: reviewScope });
    expect(mocks.local[activeRunKey]).toMatchObject({ scope: target, status: "running" });
    expect(mocks.session[completionKey]).toBeUndefined();
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toMatchObject({
      downloadId: 231,
      requestId,
    });
    await expect(
      acquireFiledReturnsRun(target, { storageKeys: { activeRun: activeRunKey } }),
    ).resolves.toMatchObject({
      response: { flowStep: { safeSignals: ["filed-returns-run-active"] } },
    });
  });

  it("surfaces an unavailable startup checkpoint scan even when another target owns the review record", async () => {
    persistActiveRun();
    const otherTarget = { ...target, period: "April" };
    await persistFiledReturnsTargetReview(
      otherTarget,
      {
        connectorId: "gst",
        scopeId: filedReturnScopeId(otherTarget.returnType),
        state: "blocked",
        safeMessage: "Pack retained another target for review.",
        safeSignals: ["artifact-acquisition-download-unreconciled"],
        userAction: {
          canResume: true,
          message: "Review or cancel this target before starting another portal action.",
          type: "RETRY_PORTAL_GENERATION",
        },
      },
      durableDeps(),
    );
    mocks.browser.storage.session.get.mockRejectedValueOnce(
      new Error("Synthetic session storage read failure."),
    );

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).resolves.toBe(true);

    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
    expect(mocks.browser.storage.local.set).toHaveBeenCalledWith({
      [activeRunKey]: expect.objectContaining({ status: "recovery-blocked" }),
    });
    expect(mocks.local[activeRunKey]).toMatchObject({ status: "recovery-blocked" });
    expect(mocks.local[targetReviewKey]).toMatchObject({
      scope: otherTarget,
    });
    await expect(
      readCurrentFiledReturnsFlowSummary({
        storageKeys: {
          activeRun: activeRunKey,
          completion: completionKey,
          fullFiscalYearLedger: "pack:full-fiscal-year-ledger",
          targetReview: targetReviewKey,
        },
      }),
    ).resolves.toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining(["artifact-acquisition-checkpoint-read-unavailable"]),
      },
      status: "blocked",
    });
  });

  it("keeps a marked review recoverable if cleanup stops after completion persistence", async () => {
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
    mocks.browser.downloads.search.mockResolvedValue([
      {
        danger: "safe",
        fileSize: 40_108,
        id: 231,
        mime: "application/pdf",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);
    mocks.browser.storage.local.remove.mockRejectedValueOnce(
      new Error("Synthetic worker stop after completion persistence."),
    );

    await expect(
      reconcileTerminalFiledReturnsDownload(
        { search: mocks.browser.downloads.search },
        durableDeps(),
      ),
    ).rejects.toThrow("Synthetic worker stop after completion persistence.");

    expect(mocks.session[completionKey]).toMatchObject({ status: "complete" });
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toBeUndefined();
    expect(mocks.local[targetReviewKey]).toMatchObject({
      artifactAcquisitionCompletion: [{ artifactType: "PDF", downloadId: 231, requestId }],
      status: "download-unconfirmed",
    });

    const response = await resolveUnconfirmedFiledReturnsDownload(
      target,
      "cancelled",
      durableDeps(),
    );

    expect(response).toMatchObject({ flowSummary: { status: "complete" }, ok: true });
    expect(mocks.local[targetReviewKey]).toBeUndefined();
  });
});
