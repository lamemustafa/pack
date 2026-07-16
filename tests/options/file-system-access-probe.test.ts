import { describe, expect, it, vi } from "vitest";
import { runFileSystemAccessProbe } from "../../src/entrypoints/options/file-system-access-probe";

describe("File System Access options probe", () => {
  it("writes, reads back, hashes, and removes only a synthetic probe file", async () => {
    const writes: unknown[] = [];
    const removedEntries: string[] = [];
    const bytes = new TextEncoder().encode(
      "ComplyEaze Pack File System Access probe\nlocal-only synthetic bytes\n",
    );
    const writable = {
      close: vi.fn(async () => undefined),
      write: vi.fn(async (value: unknown) => {
        writes.push(value);
      }),
    };
    const fileHandle = {
      createWritable: vi.fn(async () => writable),
      getFile: vi.fn(async () => ({
        arrayBuffer: async () => bytes.buffer,
      })),
    };
    const directoryHandle = {
      getFileHandle: vi.fn(async (_name: string, options?: { create?: boolean }) => {
        if (!options?.create) throw new DOMException("missing", "NotFoundError");
        return fileHandle;
      }),
      removeEntry: vi.fn(async (name: string) => {
        removedEntries.push(name);
      }),
    };

    const result = await runFileSystemAccessProbe({
      crypto: globalThis.crypto,
      showDirectoryPicker: vi.fn(
        async () => directoryHandle as unknown as FileSystemDirectoryHandle,
      ),
    });

    expect(result).toMatchObject({
      status: "supported",
      byteCount: bytes.byteLength,
      safeSignals: ["file-system-access-user-mediated", "file-system-access-readback-verified"],
    });
    expect(result.sha256Prefix).toMatch(/^[0-9a-f]{16}$/);
    expect(directoryHandle.getFileHandle).toHaveBeenNthCalledWith(
      2,
      ".complyeaze-pack-fsa-probe.txt",
      { create: true },
    );
    expect(writes).toEqual([
      "ComplyEaze Pack File System Access probe\nlocal-only synthetic bytes\n",
    ]);
    expect(writable.close).toHaveBeenCalled();
    expect(removedEntries).toEqual([".complyeaze-pack-fsa-probe.txt"]);
  });

  it("reports unsupported when the browser has no directory picker", async () => {
    await expect(
      runFileSystemAccessProbe({
        crypto: globalThis.crypto,
      }),
    ).resolves.toEqual({
      status: "unsupported",
      safeSignals: ["file-system-access-unavailable"],
    });
  });

  it("reports cancellation without retaining folder state", async () => {
    await expect(
      runFileSystemAccessProbe({
        crypto: globalThis.crypto,
        showDirectoryPicker: vi.fn(async () => {
          throw new DOMException("cancelled", "AbortError");
        }),
      }),
    ).resolves.toEqual({
      status: "cancelled",
      safeSignals: ["file-system-access-user-cancelled"],
    });
  });

  it("removes the synthetic probe when readback fails", async () => {
    const directoryHandle = {
      getFileHandle: vi.fn(async (_name: string, options?: { create?: boolean }) => {
        if (!options?.create) throw new DOMException("missing", "NotFoundError");
        return {
          createWritable: async () => ({
            write: async () => undefined,
            close: async () => undefined,
          }),
          getFile: async () => {
            throw new Error("Synthetic readback failure");
          },
        };
      }),
      removeEntry: vi.fn(async () => undefined),
    };

    await expect(
      runFileSystemAccessProbe({
        crypto: globalThis.crypto,
        showDirectoryPicker: vi.fn(
          async () => directoryHandle as unknown as FileSystemDirectoryHandle,
        ),
      }),
    ).resolves.toEqual({
      status: "failed",
      safeSignals: ["file-system-access-probe-failed"],
    });
    expect(directoryHandle.removeEntry).toHaveBeenCalledWith(".complyeaze-pack-fsa-probe.txt");
  });

  it("reports failed when the synthetic probe cannot be removed", async () => {
    const bytes = new TextEncoder().encode("synthetic");
    const directoryHandle = {
      getFileHandle: vi.fn(async (_name: string, options?: { create?: boolean }) => {
        if (!options?.create) throw new DOMException("missing", "NotFoundError");
        return {
          createWritable: async () => ({
            write: async () => undefined,
            close: async () => undefined,
          }),
          getFile: async () => ({ arrayBuffer: async () => bytes.buffer }),
        };
      }),
      removeEntry: vi.fn(async () => {
        throw new Error("Synthetic cleanup failure");
      }),
    };

    await expect(
      runFileSystemAccessProbe({
        crypto: globalThis.crypto,
        showDirectoryPicker: vi.fn(
          async () => directoryHandle as unknown as FileSystemDirectoryHandle,
        ),
      }),
    ).resolves.toEqual({
      status: "failed",
      safeSignals: ["file-system-access-probe-cleanup-failed"],
    });
  });

  it("does not overwrite or delete a pre-existing probe sentinel", async () => {
    const existingFile = {
      createWritable: vi.fn(),
      getFile: vi.fn(async () => ({
        arrayBuffer: async () => new TextEncoder().encode("unrelated local file").buffer,
      })),
    };
    const directoryHandle = {
      getFileHandle: vi.fn(async () => existingFile),
      removeEntry: vi.fn(async () => undefined),
    };

    await expect(
      runFileSystemAccessProbe({
        crypto: globalThis.crypto,
        showDirectoryPicker: vi.fn(
          async () => directoryHandle as unknown as FileSystemDirectoryHandle,
        ),
      }),
    ).resolves.toEqual({
      status: "failed",
      safeSignals: ["file-system-access-probe-file-exists"],
    });
    expect(directoryHandle.getFileHandle).toHaveBeenCalledTimes(1);
    expect(existingFile.createWritable).not.toHaveBeenCalled();
    expect(directoryHandle.removeEntry).not.toHaveBeenCalled();
  });

  it("clears an owned stale sentinel before running a fresh probe", async () => {
    const probeBytes = new TextEncoder().encode(
      "ComplyEaze Pack File System Access probe\nlocal-only synthetic bytes\n",
    );
    const staleFile = {
      getFile: async () => ({ arrayBuffer: async () => probeBytes.buffer }),
    };
    const freshFile = {
      createWritable: async () => ({
        write: async () => undefined,
        close: async () => undefined,
      }),
      getFile: async () => ({ arrayBuffer: async () => probeBytes.buffer }),
    };
    const directoryHandle = {
      getFileHandle: vi.fn().mockResolvedValueOnce(staleFile).mockResolvedValueOnce(freshFile),
      removeEntry: vi.fn(async () => undefined),
    };

    await expect(
      runFileSystemAccessProbe({
        crypto: globalThis.crypto,
        showDirectoryPicker: vi.fn(
          async () => directoryHandle as unknown as FileSystemDirectoryHandle,
        ),
      }),
    ).resolves.toMatchObject({ status: "supported" });
    expect(directoryHandle.removeEntry).toHaveBeenNthCalledWith(
      1,
      ".complyeaze-pack-fsa-probe.txt",
    );
    expect(directoryHandle.removeEntry).toHaveBeenNthCalledWith(
      2,
      ".complyeaze-pack-fsa-probe.txt",
    );
  });
});
