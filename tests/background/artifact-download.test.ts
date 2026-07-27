import { describe, expect, it, vi } from "vitest";
import { downloadAcquiredArtifact } from "../../src/background/artifact-download";

const listeners = new Set<(delta: { id: number }) => void>();
const downloads = {
  download: vi.fn(async () => 9),
  search: vi.fn(async () => [{ id: 9, state: "complete", bytesReceived: 12 }]),
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
      const result = await downloadAcquiredArtifact(
        { ...input(), mimeType, filename },
        deps({ createOffscreenBlobUrl: create }),
      );
      expect(result).toMatchObject({ ok: true, downloadId: 9, bytesReceived: 12 });
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
    },
  );

  it.each([
    ["interrupted", 12, "interrupted"],
    ["complete", 0, "empty"],
  ] as const)("fails %s downloads without completing", async (state, bytesReceived, reason) => {
    downloads.search.mockResolvedValueOnce([{ id: 9, state, bytesReceived }]);
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
    timeoutMs: 100,
    ...overrides,
  } as Parameters<typeof downloadAcquiredArtifact>[1];
}
