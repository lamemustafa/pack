export const FILE_SYSTEM_ACCESS_PHASE0_CHANNEL = "pack-file-system-access-phase0";
export const FILE_SYSTEM_ACCESS_PHASE0_DOCUMENT = "file-system-access-phase0.html";

export type FileSystemAccessPhase0Message =
  | { kind: "ready"; requestId: string }
  | { kind: "run"; requestId: string }
  | { kind: "result"; requestId: string; ok: true; byteCount: number; leadingBytes: string }
  | { kind: "result"; requestId: string; ok: false };
