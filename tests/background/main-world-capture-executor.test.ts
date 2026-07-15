import { afterEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => ({
  scripting: {
    executeScript: vi.fn(),
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));

import { capturePortalBlobDownloadInMainWorld } from "../../src/background/main-world-capture-executor";

describe("main-world capture executor", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("keeps restoration headroom beyond the injected capture timeout", async () => {
    vi.useFakeTimers();
    browserMocks.scripting.executeScript.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve([
                {
                  result: {
                    capturedDownloadRequest: {
                      actionId: "action-1",
                      dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
                      safeSignals: ["gstr2b-main-world-capture"],
                    },
                    safeFailureSignals: [],
                  },
                },
              ]),
            6_000,
          );
        }),
    );

    const capture = capturePortalBlobDownloadInMainWorld(17, {
      actionId: "action-1",
      controlAttribute: "data-pack-gstr2b-capture-action",
      controlId: "capture-1",
      maxBytes: 36 * 1024 * 1024,
      signalPrefix: "gstr2b",
      timeoutMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(capture).resolves.toMatchObject({
      capturedDownloadRequest: { actionId: "action-1" },
      safeFailureSignals: [],
    });
  });
});
