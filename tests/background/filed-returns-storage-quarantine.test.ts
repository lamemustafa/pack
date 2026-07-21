import { beforeEach, describe, expect, it, vi } from "vitest";
import { quarantineFiledReturnsStorageState } from "../../src/background/filed-returns-storage-quarantine";

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    },
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));

describe("filed returns storage quarantine", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records only bounded recovery metadata for an invalid state", async () => {
    await quarantineFiledReturnsStorageState(
      "storage-quarantine",
      "target-review",
      new Date("2026-07-21T00:00:00.000Z"),
    );

    expect(browserMocks.storage.local.set).toHaveBeenCalledWith({
      "storage-quarantine": {
        schemaVersion: "1.0",
        entries: [
          expect.objectContaining({
            key: "target-review",
            observedAt: "2026-07-21T00:00:00.000Z",
            reason: "invalid-state",
            recoveryId: expect.stringMatching(/^recovery-[a-z0-9-]{8,80}$/),
          }),
        ],
      },
    });
    const writes = browserMocks.storage.local.set.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    const serialized = JSON.stringify(writes[0]?.[0]);
    expect(serialized).not.toContain("forbidden-metadata");
  });

  it("does not duplicate a matching quarantine marker", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      "storage-quarantine": {
        schemaVersion: "1.0",
        entries: [
          {
            key: "action-journal",
            observedAt: "2026-07-21T00:00:00.000Z",
            reason: "invalid-state",
            recoveryId: "recovery-12345678",
          },
        ],
      },
    });

    await quarantineFiledReturnsStorageState("storage-quarantine", "action-journal");

    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });
});
