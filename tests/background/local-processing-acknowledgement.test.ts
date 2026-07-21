import { beforeEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    },
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));

import {
  LOCAL_PROCESSING_DISCLOSURE_VERSION,
  acknowledgeLocalProcessing,
  readLocalProcessingAcknowledgement,
} from "../../src/background/local-processing-acknowledgement";

const STORAGE_KEY = "pack:local-processing-acknowledgement";

describe("local processing acknowledgement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists only the current disclosure version and timestamp", async () => {
    const acknowledgement = await acknowledgeLocalProcessing(STORAGE_KEY, new Date("2026-07-21"));

    expect(acknowledgement).toEqual({
      version: LOCAL_PROCESSING_DISCLOSURE_VERSION,
      acknowledgedAt: "2026-07-21T00:00:00.000Z",
    });
    expect(browserMocks.storage.local.set).toHaveBeenCalledWith({
      [STORAGE_KEY]: acknowledgement,
    });
  });

  it("rejects stale, malformed, or expanded records", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      [STORAGE_KEY]: {
        version: LOCAL_PROCESSING_DISCLOSURE_VERSION,
        acknowledgedAt: "2026-07-21T00:00:00.000Z",
        label: "client name",
      },
    });

    await expect(readLocalProcessingAcknowledgement(STORAGE_KEY)).resolves.toBeNull();

    browserMocks.storage.local.get.mockResolvedValue({
      [STORAGE_KEY]: {
        version: "old-version",
        acknowledgedAt: "2026-07-21T00:00:00.000Z",
      },
    });

    await expect(readLocalProcessingAcknowledgement(STORAGE_KEY)).resolves.toBeNull();
  });
});
