import {
  clearStoredDirectoryHandle,
  getStoredDirectoryHandle,
  putStoredDirectoryHandle,
} from "../file-system-access-phase0/handle-store";
import {
  FILE_SYSTEM_ACCESS_PHASE0_CHANNEL,
  FILE_SYSTEM_ACCESS_PHASE0_DOCUMENT,
  type FileSystemAccessPhase0Message,
} from "../file-system-access-phase0/protocol";

const RESTART_PERMISSION_SIGNALS = {
  denied: "file-system-access-phase0-restart-permission-denied",
  granted: "file-system-access-phase0-restart-permission-granted",
  prompt: "file-system-access-phase0-restart-permission-prompt",
} as const;
const RESTART_PENDING_KEY = "pack-phase0-file-system-access-restart-pending";

export interface FileSystemAccessProbeResult {
  status: "supported" | "unsupported" | "cancelled" | "failed";
  safeSignals: string[];
  byteCount?: number;
  sha256Prefix?: string;
}

export interface FileSystemAccessProbeDeps {
  crypto: Pick<Crypto, "randomUUID">;
  showDirectoryPicker?: DirectoryPicker | undefined;
}

type DirectoryPicker = (options?: {
  id?: string;
  mode?: "read" | "readwrite";
}) => Promise<FileSystemDirectoryHandle>;
type PermissionDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
};

export async function runFileSystemAccessProbe(
  deps: FileSystemAccessProbeDeps = {
    crypto: globalThis.crypto,
    showDirectoryPicker: getGlobalDirectoryPicker(),
  },
): Promise<FileSystemAccessProbeResult> {
  if (localStorage.getItem(RESTART_PENDING_KEY) === "1") return completeRestartCheck();

  const picker = deps.showDirectoryPicker;
  if (typeof picker !== "function") {
    return { status: "unsupported", safeSignals: ["file-system-access-unavailable"] };
  }

  // Call the picker before any await to retain the button's user activation.
  const directoryHandlePromise = picker({
    id: "pack-phase0-file-system-access-probe",
    mode: "readwrite",
  });
  try {
    const directoryHandle = await directoryHandlePromise;
    localStorage.setItem(RESTART_PENDING_KEY, "1");
    await putStoredDirectoryHandle(directoryHandle);
    const roundTrippedHandle = await getStoredDirectoryHandle();
    if (!roundTrippedHandle) {
      localStorage.removeItem(RESTART_PENDING_KEY);
      await clearStoredDirectoryHandle();
      return failed("file-system-access-phase0-indexeddb-retrieve-failed");
    }

    const offscreenResult = await runDedicatedOffscreenProbe(deps.crypto.randomUUID());
    if (!offscreenResult.ok) {
      localStorage.removeItem(RESTART_PENDING_KEY);
      await clearStoredDirectoryHandle();
      return failed(offscreenResult.signal);
    }
    return {
      status: "supported",
      safeSignals: [
        "file-system-access-phase0-picker-ok",
        "file-system-access-phase0-indexeddb-round-trip-ok",
        "file-system-access-phase0-offscreen-write-readback-ok",
        "file-system-access-phase0-readback-bytes-match",
      ],
      byteCount: offscreenResult.byteCount,
    };
  } catch (error) {
    if (isAbortError(error)) {
      return { status: "cancelled", safeSignals: ["file-system-access-user-cancelled"] };
    }
    localStorage.removeItem(RESTART_PENDING_KEY);
    await clearStoredDirectoryHandle();
    return failed("file-system-access-phase0-initial-probe-failed");
  }
}

async function completeRestartCheck(): Promise<FileSystemAccessProbeResult> {
  try {
    const directoryHandle = await getStoredDirectoryHandle();
    if (!directoryHandle) {
      localStorage.removeItem(RESTART_PENDING_KEY);
      return failed("file-system-access-phase0-restart-handle-missing");
    }
    const permission = await (directoryHandle as PermissionDirectoryHandle).queryPermission({
      mode: "readwrite",
    });
    await clearStoredDirectoryHandle();
    localStorage.removeItem(RESTART_PENDING_KEY);
    return {
      status: "supported",
      safeSignals: [
        "file-system-access-phase0-restart-handle-retrieved",
        RESTART_PERMISSION_SIGNALS[permission],
      ],
    };
  } catch {
    await clearStoredDirectoryHandle();
    localStorage.removeItem(RESTART_PENDING_KEY);
    return failed("file-system-access-phase0-restart-handle-failed");
  }
}

async function runDedicatedOffscreenProbe(
  requestId: string,
): Promise<{ ok: true; byteCount: number; leadingBytes: string } | { ok: false; signal: string }> {
  const channel = new BroadcastChannel(FILE_SYSTEM_ACCESS_PHASE0_CHANNEL);
  let created = false;
  try {
    const ready = waitForMessage(channel, requestId, "ready");
    created = await ensureDedicatedOffscreenDocument();
    if (!created) return { ok: false, signal: "file-system-access-phase0-offscreen-unavailable" };
    await ready;
    const result = waitForMessage(channel, requestId, "result");
    channel.postMessage({ kind: "run", requestId } satisfies FileSystemAccessPhase0Message);
    const message = await result;
    if (
      message.kind !== "result" ||
      message.ok !== true ||
      typeof message.byteCount !== "number" ||
      typeof message.leadingBytes !== "string"
    ) {
      return { ok: false, signal: "file-system-access-phase0-offscreen-write-failed" };
    }
    return { ok: true, byteCount: message.byteCount, leadingBytes: message.leadingBytes };
  } catch {
    return { ok: false, signal: "file-system-access-phase0-offscreen-write-failed" };
  } finally {
    channel.close();
    if (created) await closeDedicatedOffscreenDocument();
  }
}

function waitForMessage(
  channel: BroadcastChannel,
  requestId: string,
  expectedKind: "ready" | "result",
): Promise<Extract<FileSystemAccessPhase0Message, { kind: typeof expectedKind }>> {
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      channel.removeEventListener("message", listener);
      reject(new Error("Phase 0 offscreen response timed out"));
    }, 5_000);
    const listener = (event: MessageEvent<unknown>) => {
      const message = event.data as Partial<FileSystemAccessPhase0Message>;
      if (message.kind !== expectedKind) return;
      if (expectedKind === "result" && message.requestId !== requestId) return;
      globalThis.clearTimeout(timeout);
      channel.removeEventListener("message", listener);
      resolve(message as Extract<FileSystemAccessPhase0Message, { kind: typeof expectedKind }>);
    };
    channel.addEventListener("message", listener);
  });
}

async function ensureDedicatedOffscreenDocument(): Promise<boolean> {
  const runtimeWithContexts = chrome.runtime as typeof chrome.runtime & {
    getContexts?: (filter: { contextTypes: ["OFFSCREEN_DOCUMENT"] }) => Promise<unknown[]>;
  };
  const contexts = await runtimeWithContexts.getContexts?.({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (contexts && contexts.length > 0) return false;

  const offscreen = chrome.offscreen;
  if (!offscreen) return false;
  await offscreen.createDocument({
    url: FILE_SYSTEM_ACCESS_PHASE0_DOCUMENT,
    reasons: ["BLOBS"],
    justification: "Temporary Phase 0 File System Access capability probe.",
  });
  return true;
}

async function closeDedicatedOffscreenDocument(): Promise<void> {
  try {
    await chrome.offscreen?.closeDocument();
  } catch {
    // The temporary document may already have been closed by the browser.
  }
}

function failed(signal: string): FileSystemAccessProbeResult {
  return { status: "failed", safeSignals: [signal] };
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
