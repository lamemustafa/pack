import { describe, expect, it } from "vitest";
import {
  MainWorldCaptureTransferStore,
  PACK_MAIN_WORLD_CAPTURE_MAX_CHUNKS,
  PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE,
  isMainWorldCaptureChunkMessage,
  mainWorldCaptureTransferKey,
} from "../../src/content/main-world-capture-transfer";

describe("content main-world capture transfer store", () => {
  it("accepts chunks only for a prepared transfer", () => {
    const store = new MainWorldCaptureTransferStore();
    const payload = { actionId: "action-1", transferId: "transfer-1" };

    store.acceptChunk({
      ...payload,
      chunk: "ignored",
      index: 0,
      source: PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE,
      totalChunks: 1,
    });
    expect(store.takeChunk({ ...payload, index: 0 })).toBeNull();

    store.prepare(payload);
    store.acceptChunk({
      ...payload,
      chunk: "captured",
      index: 0,
      source: PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE,
      totalChunks: 1,
    });
    expect(store.takeChunk({ ...payload, index: 0 })).toBe("captured");
  });

  it("keeps transfers isolated and clearable", () => {
    const store = new MainWorldCaptureTransferStore();
    const first = { actionId: "action-1", transferId: "transfer-1" };
    const second = { actionId: "action-1", transferId: "transfer-2" };

    store.prepare(first);
    store.prepare(second);
    store.acceptChunk({
      ...first,
      chunk: "first",
      index: 0,
      source: PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE,
      totalChunks: 1,
    });
    store.acceptChunk({
      ...second,
      chunk: "second",
      index: 0,
      source: PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE,
      totalChunks: 1,
    });

    expect(store.takeChunk({ ...first, index: 0 })).toBe("first");
    expect(store.takeChunk({ ...second, index: 0 })).toBe("second");

    store.clear(first);

    expect(store.takeChunk({ ...first, index: 0 })).toBeNull();
    expect(store.takeChunk({ ...second, index: 0 })).toBe("second");
  });

  it("rejects malformed and oversized chunk messages", () => {
    expect(
      isMainWorldCaptureChunkMessage({
        actionId: "action-1",
        chunk: "captured",
        index: 0,
        source: PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE,
        totalChunks: 1,
        transferId: "transfer-1",
      }),
    ).toBe(true);
    expect(
      isMainWorldCaptureChunkMessage({
        actionId: "action-1",
        chunk: "captured",
        index: 0,
        source: PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE,
        totalChunks: PACK_MAIN_WORLD_CAPTURE_MAX_CHUNKS + 1,
        transferId: "transfer-1",
      }),
    ).toBe(false);
    expect(
      isMainWorldCaptureChunkMessage({
        actionId: "action-1",
        chunk: "captured",
        index: -1,
        source: PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE,
        totalChunks: 1,
        transferId: "transfer-1",
      }),
    ).toBe(false);
  });

  it("uses action and transfer identity as the storage key", () => {
    expect(
      mainWorldCaptureTransferKey({
        actionId: "action-1",
        transferId: "transfer-1",
      }),
    ).toBe("action-1:transfer-1");
  });
});
