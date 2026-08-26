import { beforeEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => ({
  tabs: {
    get: vi.fn(),
    update: vi.fn(async () => undefined),
  },
  windows: {
    update: vi.fn(async () => undefined),
  },
  storage: {
    session: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));

import { getRequiredGstTab } from "../../src/background/filed-returns-active-tab";

describe("required GST tab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the persisted tab ID instead of acquiring a different active GST tab", async () => {
    browserMocks.tabs.get.mockResolvedValue({
      id: 41,
      url: "https://return.gst.gov.in/returns/auth/dashboard",
      windowId: 9,
    });
    const getActiveGstTab = vi.fn(async () => null);

    const result = await getRequiredGstTab(getActiveGstTab, 41);

    expect(result?.tab.id).toBe(41);
    expect(getActiveGstTab).not.toHaveBeenCalled();
    expect(browserMocks.tabs.update).toHaveBeenCalledWith(41, { active: true });
  });

  it("fails closed when the persisted GST tab no longer exists", async () => {
    browserMocks.tabs.get.mockRejectedValue(new Error("No tab with id: 41"));
    const getActiveGstTab = vi.fn();

    await expect(getRequiredGstTab(getActiveGstTab, 41)).resolves.toBeNull();
    expect(getActiveGstTab).not.toHaveBeenCalled();
    expect(browserMocks.tabs.update).not.toHaveBeenCalled();
  });

  it("fails closed when the persisted tab has navigated away from a GST host", async () => {
    browserMocks.tabs.get.mockResolvedValue({
      id: 41,
      url: "not-a-supported-gst-tab",
      windowId: 9,
    });
    const getActiveGstTab = vi.fn(async () => null);

    await expect(getRequiredGstTab(getActiveGstTab, 41)).resolves.toBeNull();
    expect(getActiveGstTab).not.toHaveBeenCalled();
    expect(browserMocks.tabs.update).not.toHaveBeenCalled();
  });

  it("fails closed when a browser restart replaces the persisted tab session marker", async () => {
    browserMocks.storage.session.get.mockResolvedValue({
      "pack:full-fiscal-year-tab-session": "new-browser-session-marker",
    });
    const getActiveGstTab = vi.fn(async () => null);

    await expect(
      getRequiredGstTab(getActiveGstTab, 41, "saved-browser-session-marker"),
    ).resolves.toBeNull();
    expect(browserMocks.tabs.get).not.toHaveBeenCalled();
    expect(getActiveGstTab).not.toHaveBeenCalled();
  });
});
