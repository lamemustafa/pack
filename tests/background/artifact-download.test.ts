import { describe, expect, it, vi } from "vitest";

const durableObserverMocks = vi.hoisted(() => ({
  beginLiveFiledReturnsDownloadObservation: vi.fn(() => vi.fn()),
}));

vi.mock("../../src/background/filed-returns-durable-download-reconciler", () => ({
  beginLiveFiledReturnsDownloadObservation:
    durableObserverMocks.beginLiveFiledReturnsDownloadObservation,
  extensionBlobUrlFingerprint: vi.fn(),
}));

import { downloadAcquiredArtifact } from "../../src/background/artifact-download";

const listeners = new Set<(delta: { id: number }) => void>();
const downloads = {
  download: vi.fn(async () => 9),
  search: vi.fn(async () => [matchingItem()]),
  onChanged: {
    addListener: vi.fn((listener: (delta: { id: number }) => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: (delta: { id: number }) => void) =>
      listeners.delete(listener),
    ),
  },
};

describe("downloadAcquiredArtifact", () => {
  it.each([
    ["PDF", "application/pdf", "ComplyEaze-Pack/2026-27/GSTR-3B/April.pdf"],
    ["JSON", "application/json", "ComplyEaze-Pack/2026-27/GSTR-3B/April.json"],
  ])(
    "delivers a small %s through its offscreen Blob URL with the exact filename",
    async (_, mimeType, filename) => {
      const create = vi.fn(async () => "blob:extension");
      const bind = vi.fn();
      const release = vi.fn();
      const reserveRequestedFilename = vi.fn(() => ({ bind, release }));
      const result = await downloadAcquiredArtifact(
        { ...input(), mimeType, filename },
        deps({
          createOffscreenBlobUrl: create,
          reserveRequestedFilename,
          downloads: {
            ...downloads,
            search: vi.fn(async () => [matchingItem(filename)]),
          } as never,
        }),
      );
      expect(result).toMatchObject({ ok: true, downloadId: 9, bytesReceived: 12, safeSignals: [] });
      expect(create).toHaveBeenCalledWith(`data:${mimeType};base64,cGRm`);
      expect(downloads.download).toHaveBeenCalledWith({
        conflictAction: "uniquify",
        filename,
        saveAs: false,
        url: "blob:extension",
      });
      expect(downloads.download).not.toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringMatching(/^data:/) }),
      );
      expect(reserveRequestedFilename).toHaveBeenCalledWith("blob:extension", filename);
      expect(bind).toHaveBeenCalledWith(9);
      expect(release).toHaveBeenCalledOnce();
    },
  );

  it("treats an exact-ID download search failure as unconfirmed", async () => {
    downloads.search.mockRejectedValueOnce(new Error("synthetic downloads unavailable"));

    await expect(downloadAcquiredArtifact(input(), deps())).resolves.toMatchObject({
      ok: false,
      reason: "search-unavailable",
      safeSignals: ["browser-download-search-unavailable"],
    });
  });

  it.each([
    ["interrupted", 12, "safe", "interrupted"],
    ["complete", 0, "safe", "empty"],
    // Danger is resolved before size, matching the shared observer: a
    // browser-blocked or still-scanning item is not evidence of a saved file
    // whatever its byte count says.
    ["complete", 12, undefined, "danger-unconfirmed"],
    ["complete", 12, "asyncScanning", "danger-unconfirmed"],
    ["complete", 12, "dangerousFile", "danger-rejected"],
  ] as const)(
    "fails %s downloads (danger %s) without completing",
    async (state, bytesReceived, danger, reason) => {
      downloads.search.mockResolvedValueOnce([{ id: 9, state, bytesReceived, danger }] as never);
      await expect(downloadAcquiredArtifact(input(), deps())).resolves.toMatchObject({
        ok: false,
        reason,
      });
    },
  );

  it("fails closed after a checkpoint callback failure without treating its download as unstarted", async () => {
    const onStartCheckpointFailed = vi.fn(async () => undefined);
    const revoke = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    await expect(
      downloadAcquiredArtifact(
        {
          ...input(),
          onStarted: vi.fn(async () => {
            throw new Error("checkpoint unavailable");
          }),
          onStartCheckpointFailed,
        },
        deps({ revokeOffscreenBlobUrl: revoke, closeOffscreenBlobDocument: close }),
      ),
    ).resolves.toMatchObject({ ok: false, reason: "checkpoint-failed" });
    expect(onStartCheckpointFailed).toHaveBeenCalledWith(9);
    expect(revoke).toHaveBeenCalledWith("blob:extension");
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps the direct artifact observer live until its checkpointed completion settles", async () => {
    let resolveStarted!: () => void;
    const endObservation = vi.fn();
    durableObserverMocks.beginLiveFiledReturnsDownloadObservation.mockReturnValueOnce(
      endObservation,
    );
    const result = downloadAcquiredArtifact(
      {
        ...input(),
        onStarted: () =>
          new Promise<void>((resolve) => {
            resolveStarted = resolve;
          }),
      },
      deps(),
    );

    await vi.waitFor(() =>
      expect(durableObserverMocks.beginLiveFiledReturnsDownloadObservation).toHaveBeenCalledWith(9),
    );
    expect(endObservation).not.toHaveBeenCalled();

    resolveStarted();
    await expect(result).resolves.toMatchObject({ ok: true, downloadId: 9 });
    expect(endObservation).toHaveBeenCalledOnce();
  });

  it("ignores a different downloadId and times out after one start", async () => {
    vi.useFakeTimers();
    downloads.search.mockResolvedValue([]);
    const result = downloadAcquiredArtifact(input(), deps({ timeoutMs: 30 }));
    for (const listener of listeners) listener({ id: 10 });
    await vi.advanceTimersByTimeAsync(30);
    await expect(result).resolves.toMatchObject({ ok: false, reason: "timeout" });
    expect(downloads.download).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("does not warn when the browser saved the exact requested filename", async () => {
    await expect(
      downloadAcquiredArtifact(
        input(),
        deps({
          downloads: { ...downloads, search: vi.fn(async () => [matchingItem()]) } as never,
        }),
      ),
    ).resolves.toMatchObject({ ok: true, safeSignals: [] });
  });

  it("does not warn when the browser applies its uniquify suffix in the requested directory", async () => {
    const result = await downloadAcquiredArtifact(
      input(),
      deps({
        downloads: {
          ...downloads,
          search: vi.fn(async () => [
            matchingItem("ComplyEaze-Pack/2026-27/GSTR-3B/April (4).pdf"),
          ]),
        } as never,
      }),
    );

    expect(result).toMatchObject({ ok: true, safeSignals: [] });
  });

  it("keeps a completed target complete when the browser saved it under a different base name", async () => {
    const observedFilename = "/synthetic/Downloads/download.pdf";
    const result = await downloadAcquiredArtifact(
      input(),
      deps({
        downloads: {
          ...downloads,
          search: vi.fn(async () => [{ ...matchingItem(), filename: observedFilename }]),
        } as never,
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      safeSignals: ["download-filename-overridden"],
      safeMessage:
        "Another extension changed where this file was saved. Check browser Downloads before using it.",
    });
  });

  it("warns when the browser saved the requested name in a different directory", async () => {
    const result = await downloadAcquiredArtifact(
      input(),
      deps({
        downloads: {
          ...downloads,
          search: vi.fn(async () => [matchingItem("ComplyEaze-Pack/2026-27/Other/April.pdf")]),
        } as never,
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      safeSignals: ["download-filename-overridden"],
    });
  });

  it("does not claim a filename override when the completion search has no item", async () => {
    vi.useFakeTimers();
    try {
      const search = vi
        .fn()
        .mockResolvedValueOnce([{ ...matchingItem(), state: "in_progress" }])
        .mockResolvedValueOnce([]);
      const result = downloadAcquiredArtifact(
        input(),
        deps({ downloads: { ...downloads, search } as never, timeoutMs: 30 }),
      );
      for (const listener of listeners) listener({ id: 9 });
      await vi.advanceTimersByTimeAsync(30);

      await expect(result).resolves.toMatchObject({
        ok: false,
        reason: "timeout",
        safeSignals: [],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["successful completion", undefined, undefined],
    ["Blob creation failure", vi.fn(async () => null), undefined],
    [
      "download start failure",
      undefined,
      vi.fn(async () => {
        throw new Error("rejected");
      }),
    ],
  ])(
    "revokes its Blob URL and closes the offscreen document after %s",
    async (_, createOverride, downloadOverride) => {
      const revoke = vi.fn(async () => undefined);
      const close = vi.fn(async () => undefined);
      await downloadAcquiredArtifact(
        input(),
        deps({
          createOffscreenBlobUrl: createOverride ?? vi.fn(async () => "blob:extension"),
          downloads: (downloadOverride
            ? { ...downloads, download: downloadOverride }
            : downloads) as never,
          revokeOffscreenBlobUrl: revoke,
          closeOffscreenBlobDocument: close,
        }),
      );
      if (createOverride) expect(revoke).not.toHaveBeenCalled();
      else expect(revoke).toHaveBeenCalledWith("blob:extension");
      expect(close).toHaveBeenCalledOnce();
    },
  );
});

function input() {
  return {
    requestId: "request-1",
    base64: "cGRm",
    filename: "ComplyEaze-Pack/2026-27/GSTR-3B/April.pdf",
    mimeType: "application/pdf",
  };
}
function deps(overrides: Parameters<typeof downloadAcquiredArtifact>[1] = {}) {
  listeners.clear();
  vi.clearAllMocks();
  return {
    downloads,
    createOffscreenBlobUrl: vi.fn(async () => "blob:extension"),
    revokeOffscreenBlobUrl: vi.fn(),
    closeOffscreenBlobDocument: vi.fn(),
    reserveRequestedFilename: vi.fn(() => ({ bind: vi.fn(), release: vi.fn() })),
    timeoutMs: 100,
    ...overrides,
  } as Parameters<typeof downloadAcquiredArtifact>[1];
}

function matchingItem(filename = input().filename, danger = "safe") {
  // Chrome always classifies a completed DownloadItem, so a fixture without
  // `danger` models a state the browser does not produce. Delivery treats an
  // unclassified item as unproven, exactly as the shared observer does.
  return {
    id: 9,
    state: "complete",
    bytesReceived: 12,
    danger,
    filename: `/synthetic/Downloads/${filename}`,
  };
}
