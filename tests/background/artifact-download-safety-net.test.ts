import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  cancel: vi.fn(async () => undefined),
  erase: vi.fn(async () => undefined),
  listener: null as ((item: { id: number; tabId?: number; url?: string }) => void) | null,
  removeListener: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    downloads: {
      cancel: mocks.cancel,
      erase: mocks.erase,
      onCreated: {
        addListener: mocks.addListener.mockImplementation(
          (listener) => (mocks.listener = listener),
        ),
        removeListener: mocks.removeListener,
      },
    },
  },
}));

import { installPortalBlobDownloadSafetyNet } from "../../src/background/artifact-download";

describe("portal Blob download safety net", () => {
  beforeEach(() => {
    mocks.listener = null;
    vi.clearAllMocks();
  });

  it("cancels and erases only the exact Pack Blob after binding", async () => {
    const safetyNet = installPortalBlobDownloadSafetyNet(17);
    const packBlobUrl = "blob:synthetic/pack-action";
    const unrelatedBlobUrl = "blob:synthetic/user-export";
    const listener = mocks.listener!;

    listener({ id: 41, tabId: 17, url: unrelatedBlobUrl });
    listener({ id: 42, tabId: 17, url: packBlobUrl });
    await Promise.resolve();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.erase).not.toHaveBeenCalled();

    await safetyNet.bind(packBlobUrl);
    await vi.waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(42));
    expect(mocks.erase).toHaveBeenCalledWith({ id: 42 });
    expect(mocks.cancel).not.toHaveBeenCalledWith(41);
    expect(mocks.erase).not.toHaveBeenCalledWith({ id: 41 });
    safetyNet.remove();
  });

  it("does not accept a MAIN-world fingerprint or other-tab Blob as cancellation authority", async () => {
    const safetyNet = installPortalBlobDownloadSafetyNet(17);
    const listener = mocks.listener!;
    await safetyNet.bind("a".repeat(64));
    listener({ id: 43, tabId: 18, url: "blob:synthetic/other-tab" });
    listener({ id: 44, tabId: 17, url: "blob:synthetic/current-tab" });
    await Promise.resolve();

    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.erase).not.toHaveBeenCalled();
    safetyNet.remove();
  });

  it("erases an exact match even if it completes before cancellation", async () => {
    mocks.cancel.mockRejectedValueOnce(new Error("already complete"));
    const safetyNet = installPortalBlobDownloadSafetyNet(17);
    const packBlobUrl = "blob:synthetic/pack-race";
    mocks.listener!({ id: 45, tabId: 17, url: packBlobUrl });

    await safetyNet.bind(packBlobUrl);
    await vi.waitFor(() => expect(mocks.erase).toHaveBeenCalledWith({ id: 45 }));
    safetyNet.remove();
  });
});
