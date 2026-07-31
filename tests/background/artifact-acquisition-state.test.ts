import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const session: Record<string, unknown> = {};
  return {
    session,
    browser: {
      downloads: { search: vi.fn() },
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: session[key] })),
          remove: vi.fn(async (key: string) => delete session[key]),
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

  it("clears only the terminal request's own target checkpoint", async () => {
    await persistArtifactAcquisitionIntent({ ...MAY_PDF, requestId: "request-may" });
    await persistArtifactAcquisitionIntent({ ...JUNE_PDF, requestId: "request-june" });

    await clearArtifactAcquisitionCheckpoint(MAY_PDF, "request-may");

    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toBeUndefined();
    expect(mocks.session[artifactAcquisitionCheckpointKey(JUNE_PDF)]).toEqual(
      expect.objectContaining({ requestId: "request-june" }),
    );
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

    await clearArtifactAcquisitionCheckpointsAfterPersistedSummary(MAY_PDF);

    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toBeUndefined();
    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_JSON)]).toEqual(
      expect.objectContaining({ downloadId: 10, state: "download-unconfirmed" }),
    );
  });
});
