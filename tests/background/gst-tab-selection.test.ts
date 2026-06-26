import { beforeEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => {
  type MockTab = {
    active?: boolean;
    id?: number;
    url?: string;
  };

  return {
    runtime: {
      id: "pack-test-extension",
      onInstalled: {
        addListener: vi.fn(),
      },
      onMessage: {
        addListener: vi.fn(),
      },
    },
    scripting: {
      executeScript: vi.fn(async () => []),
    },
    storage: {
      local: {
        set: vi.fn(async () => undefined),
        setAccessLevel: vi.fn(async () => undefined),
      },
      session: {
        set: vi.fn(async () => undefined),
      },
    },
    tabs: {
      query: vi.fn(async (query?: unknown): Promise<MockTab[]> => {
        void query;
        return [];
      }),
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
  };
});

vi.mock("wxt/browser", () => ({
  browser: browserMocks,
}));

describe("Pack GST tab selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubGlobal("defineBackground", (entrypoint: () => void) => {
      entrypoint();
      return entrypoint;
    });
  });

  it("keeps using the active GST tab when one is focused", async () => {
    browserMocks.tabs.query.mockResolvedValueOnce([
      {
        active: true,
        id: 10,
        url: "https://return.gst.gov.in/returns/auth/efiledReturns",
      },
    ]);
    const { getActiveGstTab } = await import("../../src/entrypoints/background");

    await expect(getActiveGstTab()).resolves.toMatchObject({ id: 10 });

    expect(browserMocks.tabs.query).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
  });

  it("falls back to a GST tab in the current window when the popup is open as a tab", async () => {
    browserMocks.tabs.query
      .mockResolvedValueOnce([
        {
          active: true,
          id: 20,
          url: "chrome-extension://pack-test-extension/popup.html",
        },
      ])
      .mockResolvedValueOnce([
        {
          active: true,
          id: 20,
          url: "chrome-extension://pack-test-extension/popup.html",
        },
        {
          active: false,
          id: 21,
          url: "https://return.gst.gov.in/returns/auth/efiledReturns",
        },
      ]);
    const { getActiveGstTab } = await import("../../src/entrypoints/background");

    await expect(getActiveGstTab()).resolves.toMatchObject({ id: 21 });

    expect(browserMocks.tabs.query).toHaveBeenNthCalledWith(1, {
      active: true,
      currentWindow: true,
    });
    expect(browserMocks.tabs.query).toHaveBeenNthCalledWith(2, {
      currentWindow: true,
    });
  });

  it("returns null when no GST tab exists in the current window", async () => {
    browserMocks.tabs.query
      .mockResolvedValueOnce([
        {
          active: true,
          id: 30,
          url: "chrome-extension://pack-test-extension/popup.html",
        },
      ])
      .mockResolvedValueOnce([
        {
          active: false,
          id: 31,
          url: "https://example.com/",
        },
      ]);
    const { getActiveGstTab } = await import("../../src/entrypoints/background");

    await expect(getActiveGstTab()).resolves.toBeNull();
  });
});
