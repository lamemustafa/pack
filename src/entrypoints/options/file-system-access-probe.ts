const PROBE_FILE_NAME = ".complyeaze-pack-fsa-probe.txt";
const PROBE_TEXT = "ComplyEaze Pack File System Access probe\nlocal-only synthetic bytes\n";

export interface FileSystemAccessProbeResult {
  status: "supported" | "unsupported" | "cancelled" | "failed";
  safeSignals: string[];
  byteCount?: number;
  sha256Prefix?: string;
}

export interface FileSystemAccessProbeDeps {
  crypto: Pick<Crypto, "subtle">;
  showDirectoryPicker?: DirectoryPicker | undefined;
}

type DirectoryPicker = (options?: {
  id?: string;
  mode?: "read" | "readwrite";
  startIn?: "desktop" | "documents" | "downloads";
}) => Promise<FileSystemDirectoryHandle>;

export async function runFileSystemAccessProbe(
  deps: FileSystemAccessProbeDeps = {
    crypto: globalThis.crypto,
    showDirectoryPicker: getGlobalDirectoryPicker(),
  },
): Promise<FileSystemAccessProbeResult> {
  if (typeof deps.showDirectoryPicker !== "function") {
    return {
      status: "unsupported",
      safeSignals: ["file-system-access-unavailable"],
    };
  }

  try {
    const directoryHandle = await deps.showDirectoryPicker({
      id: "pack-local-download-folder-probe",
      mode: "readwrite",
      startIn: "downloads",
    });
    const fileHandle = await directoryHandle.getFileHandle(PROBE_FILE_NAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(PROBE_TEXT);
    await writable.close();

    const file = await fileHandle.getFile();
    const bytes = await file.arrayBuffer();
    const digest = await deps.crypto.subtle.digest("SHA-256", bytes);
    await directoryHandle.removeEntry(PROBE_FILE_NAME).catch(() => undefined);

    return {
      status: "supported",
      safeSignals: ["file-system-access-user-mediated", "file-system-access-readback-verified"],
      byteCount: bytes.byteLength,
      sha256Prefix: hexPrefix(digest),
    };
  } catch (error) {
    if (isAbortError(error)) {
      return {
        status: "cancelled",
        safeSignals: ["file-system-access-user-cancelled"],
      };
    }
    return {
      status: "failed",
      safeSignals: ["file-system-access-probe-failed"],
    };
  }
}

function hexPrefix(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getGlobalDirectoryPicker(): FileSystemAccessProbeDeps["showDirectoryPicker"] {
  const globalWithPicker = globalThis as typeof globalThis & {
    showDirectoryPicker?: FileSystemAccessProbeDeps["showDirectoryPicker"];
  };
  return globalWithPicker.showDirectoryPicker;
}
