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

  let directoryHandle: FileSystemDirectoryHandle | null = null;
  let probeFileCreated = false;
  let result: FileSystemAccessProbeResult;
  try {
    directoryHandle = await deps.showDirectoryPicker({
      id: "pack-local-download-folder-probe",
      mode: "readwrite",
      startIn: "downloads",
    });
    if ((await clearOwnedStaleProbeFile(directoryHandle)) === "foreign") {
      return {
        status: "failed",
        safeSignals: ["file-system-access-probe-file-exists"],
      };
    }
    const fileHandle = await directoryHandle.getFileHandle(PROBE_FILE_NAME, { create: true });
    probeFileCreated = true;
    const writable = await fileHandle.createWritable();
    await writable.write(PROBE_TEXT);
    await writable.close();

    const file = await fileHandle.getFile();
    const bytes = await file.arrayBuffer();
    const digest = await deps.crypto.subtle.digest("SHA-256", bytes);

    result = {
      status: "supported",
      safeSignals: ["file-system-access-user-mediated", "file-system-access-readback-verified"],
      byteCount: bytes.byteLength,
      sha256Prefix: hexPrefix(digest),
    };
  } catch (error) {
    if (isAbortError(error)) {
      result = {
        status: "cancelled",
        safeSignals: ["file-system-access-user-cancelled"],
      };
    } else {
      result = {
        status: "failed",
        safeSignals: ["file-system-access-probe-failed"],
      };
    }
  } finally {
    if (directoryHandle && probeFileCreated) {
      try {
        await directoryHandle.removeEntry(PROBE_FILE_NAME);
      } catch {
        result = {
          status: "failed",
          safeSignals: ["file-system-access-probe-cleanup-failed"],
        };
      }
    }
  }
  return result;
}

async function clearOwnedStaleProbeFile(
  directoryHandle: FileSystemDirectoryHandle,
): Promise<"cleared" | "foreign" | "missing"> {
  try {
    const existingHandle = await directoryHandle.getFileHandle(PROBE_FILE_NAME);
    const existingFile = await existingHandle.getFile();
    const existingText = new TextDecoder().decode(await existingFile.arrayBuffer());
    if (existingText !== PROBE_TEXT) return "foreign";
    await directoryHandle.removeEntry(PROBE_FILE_NAME);
    return "cleared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return "missing";
    throw error;
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
