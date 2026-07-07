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
      getFileHandle: vi.fn(async () => fileHandle),
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
    expect(directoryHandle.getFileHandle).toHaveBeenCalledWith(".complyeaze-pack-fsa-probe.txt", {
      create: true,
    });
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
});
