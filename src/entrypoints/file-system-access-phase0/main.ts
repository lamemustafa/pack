import { getStoredDirectoryHandle } from "./handle-store";
import { FILE_SYSTEM_ACCESS_PHASE0_CHANNEL, type FileSystemAccessPhase0Message } from "./protocol";

const PROBE_TEXT = "ComplyEaze Pack Phase 0 synthetic bytes\n";
const PROBE_PREFIX = ".complyeaze-pack-phase0-";

const channel = new BroadcastChannel(FILE_SYSTEM_ACCESS_PHASE0_CHANNEL);
channel.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data as Partial<FileSystemAccessPhase0Message>;
  if (message.kind !== "run" || typeof message.requestId !== "string") return;
  void runProbe(message.requestId);
});

async function runProbe(requestId: string): Promise<void> {
  const directoryHandle = await getStoredDirectoryHandle();
  if (!directoryHandle) {
    reply({ kind: "result", requestId, ok: false });
    return;
  }

  const probeDirectoryName = `${PROBE_PREFIX}${crypto.randomUUID()}`;
  let created = false;
  let result: Extract<FileSystemAccessPhase0Message, { kind: "result" }> = {
    kind: "result",
    requestId,
    ok: false,
  };
  try {
    if (await directoryExists(directoryHandle, probeDirectoryName)) {
      throw new Error("Probe directory unexpectedly already exists");
    }
    const probeDirectory = await directoryHandle.getDirectoryHandle(probeDirectoryName, {
      create: true,
    });
    created = true;
    const fileHandle = await probeDirectory.getFileHandle("readback.txt", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(PROBE_TEXT);
    await writable.close();

    const bytes = new Uint8Array(await (await fileHandle.getFile()).arrayBuffer());
    if (!matchesProbeBytes(bytes)) throw new Error("Probe read-back bytes did not match");
    result = {
      kind: "result",
      requestId,
      ok: true,
      byteCount: bytes.byteLength,
      leadingBytes: [...bytes]
        .slice(0, 8)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    };
  } catch {
    // Keep the fail-closed result.
  } finally {
    if (created) {
      try {
        await directoryHandle.removeEntry(probeDirectoryName, { recursive: true });
      } catch {
        result = { kind: "result", requestId, ok: false };
      }
    }
  }
  reply(result);
}

async function directoryExists(
  directoryHandle: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await directoryHandle.getDirectoryHandle(name);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return false;
    throw error;
  }
}

function matchesProbeBytes(bytes: Uint8Array): boolean {
  const expected = new TextEncoder().encode(PROBE_TEXT);
  return (
    bytes.byteLength === expected.byteLength &&
    bytes.every((byte, index) => byte === expected[index])
  );
}

function reply(message: FileSystemAccessPhase0Message): void {
  channel.postMessage(message);
}

channel.postMessage({ kind: "ready", requestId: "" } satisfies FileSystemAccessPhase0Message);
