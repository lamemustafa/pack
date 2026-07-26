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
  it("completes only its exact, non-empty extension download with saveAs disabled", async () => {
    const result = await downloadAcquiredArtifact(input(), deps());
    expect(result).toMatchObject({ ok: true, downloadId: 9, bytesReceived: 12 });
    expect(downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ conflictAction: "uniquify", saveAs: false }),
    );
  });

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

  it("revokes and closes an offscreen URL on every large-artifact exit", async () => {
    const revoke = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    await downloadAcquiredArtifact(
      { ...input(), base64: "x".repeat(1_500_001) },
      deps({
        createOffscreenBlobUrl: vi.fn(async () => "blob:extension"),
        revokeOffscreenBlobUrl: revoke,
        closeOffscreenBlobDocument: close,
      }),
    );
    expect(revoke).toHaveBeenCalledWith("blob:extension");
    expect(close).toHaveBeenCalledOnce();
  });
});

function input() {
  return {
    requestId: "request-1",
    base64: "cGRm",
    filename: "Pack/2024-25/April/GSTR-3B.pdf",
    mimeType: "application/pdf",
  };
}
function deps(overrides: Parameters<typeof downloadAcquiredArtifact>[1] = {}) {
  listeners.clear();
  vi.clearAllMocks();
  return {
    downloads,
    createOffscreenBlobUrl: vi.fn(),
    revokeOffscreenBlobUrl: vi.fn(),
    closeOffscreenBlobDocument: vi.fn(),
    timeoutMs: 100,
    ...overrides,
  } as Parameters<typeof downloadAcquiredArtifact>[1];
}
