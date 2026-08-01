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
} from "../../src/background/artifact-acquisition-state";
import { reconcileTerminalFiledReturnsDownload } from "../../src/background/filed-returns-durable-download-reconciler";
import { filedReturnScopeId } from "../../src/connectors/gst/filed-returns-return-descriptors";
import {
  persistFiledReturnsTargetReview,
  resolveUnconfirmedFiledReturnsDownload,
} from "../../src/background/filed-returns-target-review";

const completionKey = "pack:last-filed-returns-flow-summary";
const targetReviewKey = "pack:filed-returns-target-review";
const target = {
  artifactType: "PDF" as const,
  financialYear: "2026-27",
  period: "May",
  returnType: "GSTR-3B" as const,
};
const requestId = "00000000-0000-4000-8000-000000000001";

function durableDeps() {
  return {
    storageKeys: { completion: completionKey, targetReview: targetReviewKey },
  };
}

describe("durable acquisition checkpoint recovery", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.local)) delete mocks.local[key];
    for (const key of Object.keys(mocks.session)) delete mocks.session[key];
    vi.clearAllMocks();
  });

  it("persists a completion and clears its checkpoint after a worker restart, while an in-progress download remains reviewed", async () => {
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
