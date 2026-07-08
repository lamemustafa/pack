import type { MainWorldCaptureTransferPayload } from "../core/messages";

export const PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE = "pack-main-world-capture-v1";
export const PACK_MAIN_WORLD_CAPTURE_MAX_CHUNKS = 200;

interface MainWorldCaptureTransfer {
  actionId: string;
  chunks: string[];
  transferId: string;
}

export interface MainWorldCaptureChunkMessage {
  actionId: string;
  chunk: string;
  index: number;
  source: typeof PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE;
  totalChunks: number;
  transferId: string;
}

export class MainWorldCaptureTransferStore {
  private readonly transfers = new Map<string, MainWorldCaptureTransfer>();

  prepare(payload: MainWorldCaptureTransferPayload): void {
    this.transfers.set(mainWorldCaptureTransferKey(payload), {
      actionId: payload.actionId,
      chunks: [],
      transferId: payload.transferId,
    });
  }

  acceptChunk(message: MainWorldCaptureChunkMessage): void {
    const transfer = this.transfers.get(mainWorldCaptureTransferKey(message));
    if (!transfer || transfer.actionId !== message.actionId) return;
    if (message.index >= message.totalChunks) return;
    transfer.chunks[message.index] = message.chunk;
  }

  takeChunk(payload: MainWorldCaptureTransferPayload & { index: number }): string | null {
    return this.transfers.get(mainWorldCaptureTransferKey(payload))?.chunks[payload.index] ?? null;
  }

  clear(payload: MainWorldCaptureTransferPayload): void {
    this.transfers.delete(mainWorldCaptureTransferKey(payload));
  }
}

export function mainWorldCaptureTransferKey(payload: MainWorldCaptureTransferPayload): string {
  return `${payload.actionId}:${payload.transferId}`;
}

export function isMainWorldCaptureChunkMessage(input: unknown): input is MainWorldCaptureChunkMessage {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Record<string, unknown>;
  return (
    record.source === PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE &&
    typeof record.actionId === "string" &&
    typeof record.transferId === "string" &&
    typeof record.chunk === "string" &&
    typeof record.index === "number" &&
    Number.isInteger(record.index) &&
    record.index >= 0 &&
    typeof record.totalChunks === "number" &&
    Number.isInteger(record.totalChunks) &&
    record.totalChunks > 0 &&
    record.totalChunks <= PACK_MAIN_WORLD_CAPTURE_MAX_CHUNKS
  );
}
