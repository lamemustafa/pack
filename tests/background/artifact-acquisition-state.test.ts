import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const session: Record<string, unknown> = {};
  return {
    session,
    browser: {
      downloads: { cancel: vi.fn(), search: vi.fn() },
      storage: {
        session: {
          get: vi.fn(async (keys?: string | string[]) => {
            if (keys === undefined) return { ...session };
            return Object.fromEntries(
              (Array.isArray(keys) ? keys : [keys]).map((key) => [key, session[key]]),
            );
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete session[key];
          }),
          set: vi.fn(async (values: Record<string, unknown>) => Object.assign(session, values)),
        },
      },
    },
  };
});
vi.mock("wxt/browser", () => ({ browser: mocks.browser }));

import {
  artifactAcquisitionCheckpointKey,
  clearArtifactAcquisitionCheckpoint,
  clearArtifactAcquisitionCheckpoints,
  clearArtifactAcquisitionCheckpointsAfterPersistedSummary,
  persistArtifactAcquisitionDownloadId,
  persistArtifactAcquisitionIntent,
  persistArtifactAcquisitionUnconfirmedDownload,
  reconcileArtifactAcquisitionCheckpoint,
} from "../../src/background/artifact-acquisition-state";

const MAY_PDF = {
  artifactType: "PDF" as const,
  financialYear: "2025-26",
  period: "May",
  returnType: "GSTR-3B" as const,
};
const JUNE_PDF = { ...MAY_PDF, period: "June" };
const MAY_JSON = { ...MAY_PDF, artifactType: "JSON" as const };
const MAY_DEFAULT_ARTIFACT = {
  financialYear: MAY_PDF.financialYear,
  period: MAY_PDF.period,
  returnType: MAY_PDF.returnType,
};
const MAY_COMPOSITE = {
  artifactType: "PDF_AND_EXCEL" as const,
  financialYear: "2025-26",
  period: "May",
  returnType: "GSTR-2B" as const,
};

describe("artifact acquisition checkpoint", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.session)) delete mocks.session[key];
    vi.clearAllMocks();
  });

  it("does not block June PDF or May JSON behind a stale May PDF download", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: "request-may-pdf",
      state: "download-observing",
    });

    await expect(reconcileArtifactAcquisitionCheckpoint(JUNE_PDF)).resolves.toEqual({
      state: "retry-safe",
    });
    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_JSON)).resolves.toEqual({
      state: "retry-safe",
    });
    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
  });

  it("keeps an unresolved download bound to its exact May PDF target", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: "request-may-pdf",
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([]);

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-unreconciled"],
    });
  });

  it("treats an omitted artifact type as the default PDF target during recovery", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: "request-default-pdf",
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([]);

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_DEFAULT_ARTIFACT)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-unreconciled"],
    });
  });

  it("blocks an intent-only checkpoint because a start may have escaped persistence", async () => {
    await persistArtifactAcquisitionIntent({ ...MAY_PDF, requestId: "request-intent" });

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-start-unreconciled"],
    });
  });

  it("blocks a download whose correlation checkpoint could not be persisted", async () => {
    await persistArtifactAcquisitionUnconfirmedDownload({
      ...MAY_PDF,
      downloadId: 9,
      requestId: "request-unconfirmed",
      state: "download-unconfirmed",
    });

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-unconfirmed"],
    });
  });

  it("keeps a completed-but-unpersisted download checkpoint in review", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: "request-complete",
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([
      { id: 9, state: "complete", bytesReceived: 4 },
    ]);

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-completed-unpersisted"],
    });
    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toEqual(
      expect.objectContaining({ downloadId: 9, state: "download-observing" }),
    );
  });

  it("keeps a checkpoint with an unresolvable download ID in needs-review", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: "request-unavailable",
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockRejectedValue(new Error("downloads unavailable"));

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-search-unavailable"],
    });
  });

  it("keeps a checkpoint with an in-progress download ID in needs-review", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: "request-in-progress",
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([{ id: 9, state: "in_progress" }]);

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-unreconciled"],
    });
  });

  it("retains an interrupted download checkpoint instead of permitting another portal action", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: "request-interrupted",
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([{ id: 9, state: "interrupted" }]);

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-interrupted"],
    });
    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toEqual(
      expect.objectContaining({ downloadId: 9, state: "download-observing" }),
    );
  });

  it("replaces malformed checkpoint metadata with a fail-closed session sentinel", async () => {
    mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)] = { state: "download-observing" };

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-checkpoint-malformed"],
    });
    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toEqual({
      schemaVersion: "1.0",
      state: "malformed",
    });
  });

  it("clears only the terminal request's own target checkpoint", async () => {
    await persistArtifactAcquisitionIntent({ ...MAY_PDF, requestId: "request-may" });
    await persistArtifactAcquisitionIntent({ ...JUNE_PDF, requestId: "request-june" });

    await clearArtifactAcquisitionCheckpoint(MAY_PDF, "request-may");

    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toBeUndefined();
    expect(mocks.session[artifactAcquisitionCheckpointKey(JUNE_PDF)]).toEqual(
      expect.objectContaining({ requestId: "request-june" }),
    );
  });

  it("clears every concrete interrupted checkpoint when a composite target review is cancelled", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_COMPOSITE,
      artifactType: "PDF",
      downloadId: 9,
      requestId: "request-may-pdf",
      state: "download-observing",
    });
    await persistArtifactAcquisitionDownloadId({
      ...MAY_COMPOSITE,
      artifactType: "EXCEL",
      downloadId: 10,
      requestId: "request-may-excel",
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([{ state: "interrupted" }]);

    await expect(clearArtifactAcquisitionCheckpoints(MAY_COMPOSITE)).resolves.toEqual({
      state: "cleared",
    });

    expect(
      mocks.session[artifactAcquisitionCheckpointKey({ ...MAY_COMPOSITE, artifactType: "PDF" })],
    ).toBeUndefined();
    expect(
      mocks.session[artifactAcquisitionCheckpointKey({ ...MAY_COMPOSITE, artifactType: "EXCEL" })],
    ).toBeUndefined();
    await expect(
      reconcileArtifactAcquisitionCheckpoint({ ...MAY_COMPOSITE, artifactType: "PDF" }),
    ).resolves.toEqual({ state: "retry-safe" });
    await expect(
      reconcileArtifactAcquisitionCheckpoint({ ...MAY_COMPOSITE, artifactType: "EXCEL" }),
    ).resolves.toEqual({ state: "retry-safe" });
  });

  it("cancels exact active downloads before clearing their checkpoints", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_COMPOSITE,
      artifactType: "PDF",
      downloadId: 9,
      requestId: "request-may-pdf",
      state: "download-observing",
    });
    await persistArtifactAcquisitionDownloadId({
      ...MAY_COMPOSITE,
      artifactType: "EXCEL",
      downloadId: 10,
      requestId: "request-may-excel",
      state: "download-observing",
    });
    mocks.browser.downloads.search
      .mockResolvedValueOnce([{ state: "in_progress" }])
      .mockResolvedValueOnce([{ state: "interrupted" }])
      .mockResolvedValueOnce([{ state: "in_progress" }])
      .mockResolvedValueOnce([{ state: "interrupted" }]);
    mocks.browser.downloads.cancel.mockResolvedValue(undefined);

    await expect(clearArtifactAcquisitionCheckpoints(MAY_COMPOSITE)).resolves.toEqual({
      state: "cleared",
    });

    expect(mocks.browser.downloads.cancel).toHaveBeenNthCalledWith(1, 9);
    expect(mocks.browser.downloads.cancel).toHaveBeenNthCalledWith(2, 10);
  });

  it("reconciles every expected artifact only from distinct safe, non-empty exact downloads", async () => {
    for (const [artifactType, downloadId, requestId] of [
      ["PDF", 9, "request-may-pdf"],
      ["EXCEL", 10, "request-may-excel"],
    ] as const) {
      await persistArtifactAcquisitionDownloadId({
        ...MAY_COMPOSITE,
        artifactType,
        downloadId,
        requestId,
        state: "download-observing",
      });
    }
    mocks.browser.downloads.search.mockImplementation(async ({ id }: { id: number }) => [
      {
        danger: "safe",
        fileSize: 2048,
        id,
        mime:
          id === 9
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);

    await expect(clearArtifactAcquisitionCheckpoints(MAY_COMPOSITE)).resolves.toEqual({
      state: "completed",
      evidence: [
        { artifactType: "PDF", downloadId: 9, requestId: "request-may-pdf" },
        { artifactType: "EXCEL", downloadId: 10, requestId: "request-may-excel" },
      ],
    });
    expect(mocks.browser.downloads.cancel).not.toHaveBeenCalled();
    expect(
      mocks.session[artifactAcquisitionCheckpointKey({ ...MAY_COMPOSITE, artifactType: "PDF" })],
    ).toEqual(expect.objectContaining({ downloadId: 9 }));
  });

  it("clears rather than completes a composite with only part-evidenced downloads", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_COMPOSITE,
      artifactType: "PDF",
      downloadId: 9,
      requestId: "request-may-pdf",
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([
      {
        danger: "safe",
        fileSize: 2048,
        id: 9,
        mime: "application/pdf",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);

    await expect(clearArtifactAcquisitionCheckpoints(MAY_COMPOSITE)).resolves.toEqual({
      state: "cleared",
    });
  });

  it("keeps a completed download blocked when the browser did not classify it safe", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: "request-may-pdf",
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([
      {
        danger: "uncommon",
        fileSize: 2048,
        id: 9,
        mime: "application/pdf",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);

    await expect(clearArtifactAcquisitionCheckpoints(MAY_PDF)).resolves.toEqual({
      state: "blocked",
    });
    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toEqual(
      expect.objectContaining({ downloadId: 9 }),
    );
  });

  it("removes the malformed checkpoint sentinel without touching a browser download", async () => {
    const key = artifactAcquisitionCheckpointKey(MAY_PDF);
    mocks.session[key] = { schemaVersion: "1.0", state: "malformed" };

    await expect(clearArtifactAcquisitionCheckpoints(MAY_PDF)).resolves.toEqual({
      state: "cleared",
    });
    expect(mocks.session[key]).toBeUndefined();
    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
    expect(mocks.browser.downloads.cancel).not.toHaveBeenCalled();
  });

  it("keeps an otherwise safe completed download blocked when its target correlation is stale", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: "request-may-pdf",
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([
      {
        danger: "safe",
        fileSize: 2048,
        id: 9,
        mime: "application/pdf",
        startTime: "2020-01-01T00:00:00.000Z",
        state: "complete",
      },
    ]);

    await expect(clearArtifactAcquisitionCheckpoints(MAY_PDF)).resolves.toEqual({
      state: "blocked",
    });
  });

  it("keeps an otherwise safe completed download blocked when its artifact type does not match", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: "request-may-pdf",
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([
      {
        danger: "safe",
        fileSize: 2048,
        id: 9,
        mime: "application/json",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);

    await expect(clearArtifactAcquisitionCheckpoints(MAY_PDF)).resolves.toEqual({
      state: "blocked",
    });
  });

  it("treats an absent checkpoint as already cleared so a restart cannot block the target forever", async () => {
    // Chrome clears storage.session when the extension is disabled, reloaded or
    // updated and when the browser restarts; the target review lives in
    // storage.local and survives all four. If absence counted as a failed
    // clear, the review could never be resolved and an extension update alone
    // would strand the target permanently.
    await expect(clearArtifactAcquisitionCheckpoints(MAY_COMPOSITE)).resolves.toEqual({
      state: "cleared",
    });
    expect(mocks.browser.downloads.cancel).not.toHaveBeenCalled();
  });

  it("refuses to cancel a download ID whose checkpoint does not describe this target", async () => {
    // Chrome does not document whether a DownloadItem id is ever reused, so a
    // record that no longer describes the target under whose key it sits is not
    // permission to cancel the id it carries.
    const key = artifactAcquisitionCheckpointKey({ ...MAY_COMPOSITE, artifactType: "PDF" });
    mocks.session[key] = {
      requestId: "request-drifted",
      state: "download-observing",
      downloadId: 9,
      returnType: MAY_COMPOSITE.returnType,
      financialYear: MAY_COMPOSITE.financialYear,
      period: "April",
      artifactType: "PDF",
    };
    mocks.browser.downloads.search.mockResolvedValue([{ state: "in_progress" }]);

    await expect(clearArtifactAcquisitionCheckpoints(MAY_COMPOSITE)).resolves.toEqual({
      state: "blocked",
    });
    expect(mocks.browser.downloads.cancel).not.toHaveBeenCalled();
    expect(mocks.session[key]).toBeDefined();
  });

  it("retains completed checkpoints when cancellation cannot make them retry-safe", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_COMPOSITE,
      artifactType: "PDF",
      downloadId: 9,
      requestId: "request-may-pdf",
      state: "download-observing",
    });
    await persistArtifactAcquisitionDownloadId({
      ...MAY_COMPOSITE,
      artifactType: "EXCEL",
      downloadId: 10,
      requestId: "request-may-excel",
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([{ state: "complete" }]);

    await expect(clearArtifactAcquisitionCheckpoints(MAY_COMPOSITE)).resolves.toEqual({
      state: "blocked",
    });

    expect(
      mocks.session[artifactAcquisitionCheckpointKey({ ...MAY_COMPOSITE, artifactType: "PDF" })],
    ).toBeDefined();
    expect(
      mocks.session[artifactAcquisitionCheckpointKey({ ...MAY_COMPOSITE, artifactType: "EXCEL" })],
    ).toBeDefined();
    expect(mocks.browser.downloads.cancel).not.toHaveBeenCalled();
  });

  it("clears a completed target only after its summary is durable", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: "request-may-pdf",
      state: "download-observing",
    });
    await persistArtifactAcquisitionUnconfirmedDownload({
      ...MAY_JSON,
      downloadId: 10,
      requestId: "request-may-json",
      state: "download-unconfirmed",
    });

    await clearArtifactAcquisitionCheckpointsAfterPersistedSummary(MAY_PDF, [
      { artifactType: "PDF", downloadId: 9, requestId: "request-may-pdf" },
    ]);

    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toBeUndefined();
    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_JSON)]).toEqual(
      expect.objectContaining({ downloadId: 10, state: "download-unconfirmed" }),
    );
  });

  it("does not clear a replacement checkpoint after a recovered summary persists", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 10,
      requestId: "request-replacement",
      state: "download-observing",
    });

    await clearArtifactAcquisitionCheckpointsAfterPersistedSummary(MAY_PDF, [
      { artifactType: "PDF", downloadId: 9, requestId: "request-original" },
    ]);

    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toEqual(
      expect.objectContaining({ downloadId: 10, requestId: "request-replacement" }),
    );
  });
});
