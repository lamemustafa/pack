import { describe, expect, it, vi } from "vitest";
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
      const releaseRequestedFilename = vi.fn();
      const trackRequestedFilename = vi.fn();
      const result = await downloadAcquiredArtifact(
        { ...input(), mimeType, filename },
        deps({
          createOffscreenBlobUrl: create,
          releaseRequestedFilename,
          trackRequestedFilename,
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
      expect(trackRequestedFilename).toHaveBeenCalledWith(9, filename);
      expect(releaseRequestedFilename).toHaveBeenCalledWith(9);
    },
  );

  it.each([
    ["interrupted", 12, "interrupted"],
    ["complete", 0, "empty"],
  ] as const)("fails %s downloads without completing", async (state, bytesReceived, reason) => {
    downloads.search.mockResolvedValueOnce([{ id: 9, state, bytesReceived }] as never);
    await expect(downloadAcquiredArtifact(input(), deps())).resolves.toMatchObject({
      ok: false,
      reason,
    });
  });

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
        "Another extension changed where this file was saved; Pack asked for ComplyEaze-Pack/2026-27/GSTR-3B/April.pdf; the browser saved it elsewhere as download.pdf.",
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
    releaseRequestedFilename: vi.fn(),
    trackRequestedFilename: vi.fn(),
    timeoutMs: 100,
    ...overrides,
  } as Parameters<typeof downloadAcquiredArtifact>[1];
}

function matchingItem(filename = input().filename) {
  return {
    id: 9,
    state: "complete",
    bytesReceived: 12,
    filename: `/synthetic/Downloads/${filename}`,
  };
}
