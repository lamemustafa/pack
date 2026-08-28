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
  PACK_ARTIFACT_ACQUISITION_KEY_PREFIX,
  artifactAcquisitionCheckpointKey,
  clearArtifactAcquisitionCheckpoint,
  clearArtifactAcquisitionCheckpoints,
  clearArtifactAcquisitionCheckpointsAfterPersistedSummary,
  clearMalformedArtifactAcquisitionCheckpoint,
  createMalformedArtifactAcquisitionCheckpointReference,
  readArtifactAcquisitionCheckpoints,
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

function actionId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

async function persistCancellationDownload(requestId: string): Promise<void> {
  await persistArtifactAcquisitionDownloadId({
    ...MAY_PDF,
    downloadId: 9,
    requestId,
    state: "download-observing",
  });
}

function completedCancellationDownload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    danger: "safe",
    fileSize: 2048,
    id: 9,
    mime: "application/pdf",
    startTime: new Date(Date.now() + 1_000).toISOString(),
    state: "complete",
    ...overrides,
  };
}

describe("artifact acquisition checkpoint", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.session)) delete mocks.session[key];
    vi.clearAllMocks();
    mocks.browser.downloads.cancel.mockReset();
    mocks.browser.downloads.search.mockReset();
    mocks.browser.storage.session.get.mockReset();
    mocks.browser.storage.session.remove.mockReset();
    mocks.browser.storage.session.set.mockReset();
    mocks.browser.storage.session.get.mockImplementation(async (keys?: string | string[]) => {
      if (keys === undefined) return { ...mocks.session };
      return Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((key) => [key, mocks.session[key]]),
      );
    });
    mocks.browser.storage.session.remove.mockImplementation(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete mocks.session[key];
    });
    mocks.browser.storage.session.set.mockImplementation(async (values: Record<string, unknown>) =>
      Object.assign(mocks.session, values),
    );
  });

  it("does not block June PDF or May JSON behind a stale May PDF download", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: actionId(1),
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

  it("enumerates by canonical key so a mismatched value remains fail-closed", async () => {
    const key = artifactAcquisitionCheckpointKey(MAY_PDF);
    mocks.session[key] = {
      ...MAY_PDF,
      armedAt: new Date().toISOString(),
      artifactType: "JSON",
      requestId: actionId(1),
      state: "intent",
    };

    await expect(readArtifactAcquisitionCheckpoints()).resolves.toEqual([
      { state: "target", target: MAY_PDF },
    ]);
  });

  it("surfaces unsupported key selections as an exact malformed record", async () => {
    const key = `${PACK_ARTIFACT_ACQUISITION_KEY_PREFIX}.GSTR-3B.2025-99.May.PDF`;
    mocks.session[key] = { schemaVersion: "1.0", state: "malformed" };

    await expect(readArtifactAcquisitionCheckpoints()).resolves.toEqual([
      { key, state: "malformed" },
    ]);
  });

  it("surfaces decodable noncanonical keys as exact malformed records", async () => {
    const key = `${PACK_ARTIFACT_ACQUISITION_KEY_PREFIX}.%47STR-3B.2025-26.May.PDF`;
    mocks.session[key] = { schemaVersion: "1.0", state: "malformed" };

    await expect(readArtifactAcquisitionCheckpoints()).resolves.toEqual([
      { key, state: "malformed" },
    ]);
  });

  it("removes only the explicitly reviewed malformed record", async () => {
    const firstKey = `${PACK_ARTIFACT_ACQUISITION_KEY_PREFIX}.bad-one`;
    const secondKey = `${PACK_ARTIFACT_ACQUISITION_KEY_PREFIX}.bad-two`;
    mocks.session[firstKey] = { untrusted: true };
    mocks.session[secondKey] = { untrusted: true };

    const firstReference = await createMalformedArtifactAcquisitionCheckpointReference(firstKey);
    expect(firstReference).toMatch(/^[a-zA-Z0-9-]+$/);
    await expect(clearMalformedArtifactAcquisitionCheckpoint(firstReference!)).resolves.toBe(true);

    expect(mocks.session[firstKey]).toBeUndefined();
    expect(mocks.session[secondKey]).toEqual({ untrusted: true });
  });

  it("binds and clears a malformed checkpoint key beyond the old arbitrary limit", async () => {
    const key = `${PACK_ARTIFACT_ACQUISITION_KEY_PREFIX}.${"x".repeat(600)}`;
    mocks.session[key] = { untrusted: true };

    const reference = await createMalformedArtifactAcquisitionCheckpointReference(key);

    const referenceValue = Object.entries(mocks.session).find(([storedKey]) =>
      storedKey.startsWith("pack.artifact-acquisition-review.v1."),
    )?.[1];
    expect(referenceValue).toEqual({ keyDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(referenceValue)).not.toContain(key);
    await expect(clearMalformedArtifactAcquisitionCheckpoint(reference!)).resolves.toBe(true);
    expect(mocks.session[key]).toBeUndefined();
  });

  it("keeps an unresolved download bound to its exact May PDF target", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: actionId(7),
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
      requestId: actionId(2),
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([]);

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_DEFAULT_ARTIFACT)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-unreconciled"],
    });
  });

  it("blocks an intent-only checkpoint because a start may have escaped persistence", async () => {
    await persistArtifactAcquisitionIntent({ ...MAY_PDF, requestId: actionId(8) });

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-start-unreconciled"],
    });
  });

  it("discards an intent-only checkpoint only during explicit cancellation", async () => {
    await persistArtifactAcquisitionIntent({ ...MAY_PDF, requestId: actionId(80) });

    await expect(
      clearArtifactAcquisitionCheckpoints(MAY_PDF, { discardIntent: true }),
    ).resolves.toEqual({ state: "cleared" });
    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toBeUndefined();
    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
    expect(mocks.browser.downloads.cancel).not.toHaveBeenCalled();
  });

  it("names a session-storage read failure during cancellation", async () => {
    mocks.browser.storage.session.get.mockRejectedValueOnce(new Error("synthetic read failure"));

    await expect(clearArtifactAcquisitionCheckpoints(MAY_PDF)).resolves.toEqual({
      reason: "storage-read-failed",
      state: "blocked",
    });
  });

  it.each([
    [
      "intent-discard-not-approved",
      async () => persistArtifactAcquisitionIntent({ ...MAY_PDF, requestId: actionId(82) }),
    ],
    [
      "checkpoint-invalid",
      async () => {
        mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)] = { invalid: true };
      },
    ],
    [
      "download-missing",
      async () => {
        await persistCancellationDownload(actionId(83));
        mocks.browser.downloads.search.mockResolvedValue([]);
      },
    ],
    [
      "download-state-missing",
      async () => {
        await persistCancellationDownload(actionId(84));
        mocks.browser.downloads.search.mockResolvedValue([{ id: 9 }]);
      },
    ],
    [
      "download-target-mismatch",
      async () => {
        await persistCancellationDownload(actionId(85));
        mocks.browser.downloads.search.mockResolvedValue([
          completedCancellationDownload({ mime: "application/json" }),
        ]);
      },
    ],
    [
      "download-danger-unknown",
      async () => {
        await persistCancellationDownload(actionId(86));
        mocks.browser.downloads.search.mockResolvedValue([
          completedCancellationDownload({ danger: undefined }),
        ]);
      },
    ],
    [
      "download-danger-pending",
      async () => {
        await persistCancellationDownload(actionId(87));
        mocks.browser.downloads.search.mockResolvedValue([
          completedCancellationDownload({ danger: "asyncScanning" }),
        ]);
      },
    ],
    [
      "download-danger-rejected",
      async () => {
        await persistCancellationDownload(actionId(88));
        mocks.browser.downloads.search.mockResolvedValue([
          completedCancellationDownload({ danger: "uncommon" }),
        ]);
      },
    ],
    [
      "download-size-unknown",
      async () => {
        await persistCancellationDownload(actionId(89));
        mocks.browser.downloads.search.mockResolvedValue([
          completedCancellationDownload({ fileSize: undefined }),
        ]);
      },
    ],
    [
      "download-empty",
      async () => {
        await persistCancellationDownload(actionId(90));
        mocks.browser.downloads.search.mockResolvedValue([
          completedCancellationDownload({ fileSize: 0 }),
        ]);
      },
    ],
    [
      "download-cancel-unconfirmed",
      async () => {
        await persistCancellationDownload(actionId(91));
        mocks.browser.downloads.search
          .mockResolvedValueOnce([{ id: 9, state: "in_progress" }])
          .mockResolvedValueOnce([]);
      },
    ],
    [
      "download-state-unsupported",
      async () => {
        await persistCancellationDownload(actionId(92));
        mocks.browser.downloads.search.mockResolvedValue([{ id: 9, state: "paused" }]);
      },
    ],
    [
      "download-search-failed",
      async () => {
        await persistCancellationDownload(actionId(93));
        mocks.browser.downloads.search.mockRejectedValue(new Error("synthetic search failure"));
      },
    ],
    [
      "download-cancel-failed",
      async () => {
        await persistCancellationDownload(actionId(94));
        mocks.browser.downloads.search.mockResolvedValue([{ id: 9, state: "in_progress" }]);
        mocks.browser.downloads.cancel.mockRejectedValue(new Error("synthetic cancel failure"));
      },
    ],
    [
      "storage-remove-failed",
      async () => {
        mocks.browser.storage.session.remove.mockRejectedValue(
          new Error("synthetic remove failure"),
        );
      },
    ],
  ] as const)("names the %s cancellation exit", async (reason, arrange) => {
    await arrange();

    await expect(clearArtifactAcquisitionCheckpoints(MAY_PDF)).resolves.toEqual({
      reason,
      state: "blocked",
    });
  });

  it("discards a missing exact download only during explicit cancellation", async () => {
    const key = artifactAcquisitionCheckpointKey(MAY_PDF);
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: actionId(81),
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([]);

    await expect(clearArtifactAcquisitionCheckpoints(MAY_PDF)).resolves.toEqual({
      reason: "download-missing",
      state: "blocked",
    });
    expect(mocks.session[key]).toEqual(expect.objectContaining({ downloadId: 9 }));

    await expect(
      clearArtifactAcquisitionCheckpoints(MAY_PDF, { discardMissing: true }),
    ).resolves.toEqual({ state: "cleared" });
    expect(mocks.session[key]).toBeUndefined();
    expect(mocks.browser.downloads.cancel).not.toHaveBeenCalled();
  });

  it("reconciles an exact unconfirmed checkpoint when its browser download completes", async () => {
    await persistArtifactAcquisitionUnconfirmedDownload({
      ...MAY_PDF,
      downloadId: 9,
      requestId: actionId(9),
      state: "download-unconfirmed",
    });
    mocks.browser.downloads.search.mockResolvedValue([
      {
        danger: "safe",
        fileSize: 4_096,
        id: 9,
        mime: "application/pdf",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-completed-unpersisted"],
    });
  });

  it("fails closed without cancelling an unconfirmed checkpoint with a noncanonical action ID", async () => {
    const key = artifactAcquisitionCheckpointKey(MAY_PDF);
    mocks.session[key] = {
      ...MAY_PDF,
      armedAt: new Date().toISOString(),
      downloadId: 9,
      requestId: "noncanonical-request-id",
      state: "download-unconfirmed",
    };

    await expect(clearArtifactAcquisitionCheckpoints(MAY_PDF)).resolves.toEqual({
      reason: "checkpoint-invalid",
      state: "blocked",
    });

    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
    expect(mocks.browser.downloads.cancel).not.toHaveBeenCalled();
    expect(mocks.session[key]).toMatchObject({ requestId: "noncanonical-request-id" });
  });

  it("keeps a completed-but-unpersisted download checkpoint in review", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: actionId(3),
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([
      { id: 9, state: "complete", bytesReceived: 4 },
    ]);

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["browser-download-created", "browser-download-correlation-rejected"],
    });
    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toEqual(
      expect.objectContaining({ downloadId: 9, state: "download-observing" }),
    );
  });

  it("preserves the shared observer reason when completed download proof is rejected", async () => {
    for (const [index, item, safeSignals] of [
      [
        20,
        { danger: "safe", fileSize: 4, id: 9, mime: "text/plain" },
        ["browser-download-created", "browser-download-correlation-rejected"],
      ],
      [
        21,
        { fileSize: 4, id: 9, mime: "application/pdf" },
        ["browser-download-created", "browser-download-danger-unknown"],
      ],
      [
        22,
        { danger: "asyncScanning", fileSize: 4, id: 9, mime: "application/pdf" },
        ["browser-download-created", "browser-download-danger-pending"],
      ],
      [
        23,
        { danger: "uncommon", fileSize: 4, id: 9, mime: "application/pdf" },
        [
          "browser-download-created",
          "browser-download-completed",
          "browser-download-danger-rejected",
        ],
      ],
      [
        24,
        { danger: "safe", id: 9, mime: "application/pdf" },
        ["browser-download-created", "browser-download-size-unknown"],
      ],
      [
        25,
        { danger: "safe", fileSize: 0, id: 9, mime: "application/pdf" },
        ["browser-download-completed", "browser-download-zero-bytes"],
      ],
    ] as const) {
      await persistArtifactAcquisitionDownloadId({
        ...MAY_PDF,
        downloadId: 9,
        requestId: actionId(index),
        state: "download-observing",
      });
      mocks.browser.downloads.search.mockResolvedValue([
        { ...item, startTime: new Date(Date.now() + 1_000).toISOString(), state: "complete" },
      ]);

      await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
        state: "needs-review",
        safeSignals,
      });
    }
  });

  it("keeps a checkpoint with an unresolvable download ID in needs-review", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: actionId(4),
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
      requestId: actionId(5),
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
      requestId: actionId(6),
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

  it("does not inspect a matching completed download from a forward-shaped checkpoint", async () => {
    const key = artifactAcquisitionCheckpointKey(MAY_PDF);
    mocks.session[key] = {
      ...MAY_PDF,
      armedAt: new Date().toISOString(),
      downloadId: 9,
      requestId: actionId(82),
      schemaVersion: "2.0",
      state: "download-observing",
    };
    mocks.browser.downloads.search.mockResolvedValue([
      {
        danger: "safe",
        fileSize: 2_048,
        id: 9,
        mime: "application/pdf",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-checkpoint-malformed"],
    });
    expect(mocks.session[key]).toEqual({ schemaVersion: "1.0", state: "malformed" });
    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
  });

  it("does not cancel a stale reused download ID from a forward-shaped checkpoint", async () => {
    const key = artifactAcquisitionCheckpointKey(MAY_PDF);
    mocks.session[key] = {
      ...MAY_PDF,
      armedAt: new Date().toISOString(),
      downloadId: 9,
      requestId: actionId(83),
      schemaVersion: "2.0",
      state: "download-observing",
    };
    mocks.browser.downloads.search.mockResolvedValue([{ id: 9, state: "in_progress" }]);

    await expect(clearArtifactAcquisitionCheckpoints(MAY_PDF)).resolves.toEqual({
      reason: "checkpoint-invalid",
      state: "blocked",
    });
    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
    expect(mocks.browser.downloads.cancel).not.toHaveBeenCalled();
    expect(mocks.session[key]).toEqual(expect.objectContaining({ downloadId: 9 }));
  });

  it("treats a parseable but noncanonical checkpoint timestamp as malformed", async () => {
    const key = artifactAcquisitionCheckpointKey(MAY_PDF);
    mocks.session[key] = {
      ...MAY_PDF,
      armedAt: "2026-05-01T05:30:00+05:30",
      downloadId: 9,
      requestId: actionId(84),
      state: "download-observing",
    };

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-checkpoint-malformed"],
    });
    expect(mocks.session[key]).toEqual({ schemaVersion: "1.0", state: "malformed" });
    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
  });

  it("treats a present null checkpoint as malformed instead of retry-safe", async () => {
    const key = artifactAcquisitionCheckpointKey(MAY_PDF);
    mocks.session[key] = null;

    await expect(reconcileArtifactAcquisitionCheckpoint(MAY_PDF)).resolves.toEqual({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-checkpoint-malformed"],
    });
    expect(mocks.session[key]).toEqual({ schemaVersion: "1.0", state: "malformed" });
  });

  it("clears only the terminal request's own target checkpoint", async () => {
    await persistArtifactAcquisitionIntent({ ...MAY_PDF, requestId: actionId(10) });
    await persistArtifactAcquisitionIntent({ ...JUNE_PDF, requestId: actionId(11) });

    await clearArtifactAcquisitionCheckpoint(MAY_PDF, actionId(10));

    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toBeUndefined();
    expect(mocks.session[artifactAcquisitionCheckpointKey(JUNE_PDF)]).toEqual(
      expect.objectContaining({ requestId: actionId(11) }),
    );
  });

  it("clears every concrete interrupted checkpoint when a composite target review is cancelled", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_COMPOSITE,
      artifactType: "PDF",
      downloadId: 9,
      requestId: actionId(12),
      state: "download-observing",
    });
    await persistArtifactAcquisitionDownloadId({
      ...MAY_COMPOSITE,
      artifactType: "EXCEL",
      downloadId: 10,
      requestId: actionId(13),
      state: "download-observing",
    });
    await persistArtifactAcquisitionDownloadId({
      ...MAY_COMPOSITE,
      artifactType: "JSON",
      downloadId: 11,
      requestId: actionId(14),
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
    expect(
      mocks.session[artifactAcquisitionCheckpointKey({ ...MAY_COMPOSITE, artifactType: "JSON" })],
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
      requestId: actionId(14),
      state: "download-observing",
    });
    await persistArtifactAcquisitionDownloadId({
      ...MAY_COMPOSITE,
      artifactType: "EXCEL",
      downloadId: 10,
      requestId: actionId(15),
      state: "download-observing",
    });
    await persistArtifactAcquisitionDownloadId({
      ...MAY_COMPOSITE,
      artifactType: "JSON",
      downloadId: 11,
      requestId: actionId(16),
      state: "download-observing",
    });
    mocks.browser.downloads.search
      .mockResolvedValueOnce([{ state: "in_progress" }])
      .mockResolvedValueOnce([{ state: "interrupted" }])
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
    expect(mocks.browser.downloads.cancel).toHaveBeenNthCalledWith(3, 11);
  });

  it("reconciles every expected artifact only from distinct safe, non-empty exact downloads", async () => {
    for (const [artifactType, downloadId, requestId] of [
      ["PDF", 9, actionId(16)],
      ["EXCEL", 10, actionId(17)],
      ["JSON", 11, actionId(18)],
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
            : id === 10
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "application/json",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);

    await expect(clearArtifactAcquisitionCheckpoints(MAY_COMPOSITE)).resolves.toEqual({
      state: "completed",
      evidence: [
        { artifactType: "PDF", downloadId: 9, requestId: actionId(16) },
        { artifactType: "EXCEL", downloadId: 10, requestId: actionId(17) },
        { artifactType: "JSON", downloadId: 11, requestId: actionId(18) },
      ],
    });
    expect(mocks.browser.downloads.cancel).not.toHaveBeenCalled();
    expect(
      mocks.session[artifactAcquisitionCheckpointKey({ ...MAY_COMPOSITE, artifactType: "PDF" })],
    ).toEqual(expect.objectContaining({ downloadId: 9 }));
  });

  it("explicitly discards completed composite checkpoint ownership without claiming a ZIP", async () => {
    for (const [artifactType, downloadId, requestId] of [
      ["PDF", 9, actionId(29)],
      ["EXCEL", 10, actionId(30)],
      ["JSON", 11, actionId(31)],
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
            : id === 10
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "application/json",
        startTime: new Date(Date.now() + 1_000).toISOString(),
        state: "complete",
      },
    ]);

    await expect(
      clearArtifactAcquisitionCheckpoints(MAY_COMPOSITE, { discardCompleted: true }),
    ).resolves.toEqual({ state: "cleared" });
    for (const artifactType of ["PDF", "EXCEL", "JSON"] as const) {
      expect(
        mocks.session[artifactAcquisitionCheckpointKey({ ...MAY_COMPOSITE, artifactType })],
      ).toBeUndefined();
    }
  });

  it("clears rather than completes a composite with only part-evidenced downloads", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_COMPOSITE,
      artifactType: "PDF",
      downloadId: 9,
      requestId: actionId(18),
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
      requestId: actionId(19),
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
      reason: "download-danger-rejected",
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
      requestId: actionId(26),
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
      reason: "download-target-mismatch",
      state: "blocked",
    });
  });

  it("keeps an otherwise safe completed download blocked when its artifact type does not match", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 9,
      requestId: actionId(27),
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
      reason: "download-target-mismatch",
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
      reason: "checkpoint-invalid",
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
      requestId: actionId(28),
      state: "download-observing",
    });
    mocks.browser.downloads.search.mockResolvedValue([{ state: "complete" }]);

    await expect(clearArtifactAcquisitionCheckpoints(MAY_COMPOSITE)).resolves.toEqual({
      reason: "checkpoint-invalid",
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
      requestId: actionId(29),
      state: "download-observing",
    });
    await persistArtifactAcquisitionUnconfirmedDownload({
      ...MAY_JSON,
      downloadId: 10,
      requestId: actionId(30),
      state: "download-unconfirmed",
    });

    await clearArtifactAcquisitionCheckpointsAfterPersistedSummary(MAY_PDF, [
      { artifactType: "PDF", downloadId: 9, requestId: actionId(29) },
    ]);

    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toBeUndefined();
    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_JSON)]).toEqual(
      expect.objectContaining({ downloadId: 10, state: "download-unconfirmed" }),
    );
  });

  it("clears a reconciled unconfirmed download after its summary is durable", async () => {
    await persistArtifactAcquisitionUnconfirmedDownload({
      ...MAY_PDF,
      downloadId: 9,
      requestId: actionId(31),
      state: "download-unconfirmed",
    });

    await clearArtifactAcquisitionCheckpointsAfterPersistedSummary(MAY_PDF, [
      { artifactType: "PDF", downloadId: 9, requestId: actionId(31) },
    ]);

    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toBeUndefined();
  });

  it("does not clear a replacement checkpoint after a recovered summary persists", async () => {
    await persistArtifactAcquisitionDownloadId({
      ...MAY_PDF,
      downloadId: 10,
      requestId: actionId(32),
      state: "download-observing",
    });

    await clearArtifactAcquisitionCheckpointsAfterPersistedSummary(MAY_PDF, [
      { artifactType: "PDF", downloadId: 9, requestId: actionId(33) },
    ]);

    expect(mocks.session[artifactAcquisitionCheckpointKey(MAY_PDF)]).toEqual(
      expect.objectContaining({ downloadId: 10, requestId: actionId(32) }),
    );
  });
});
