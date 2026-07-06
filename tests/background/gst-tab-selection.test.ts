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
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
    tabs: {
      get: vi.fn(async (tabId: number): Promise<MockTab> => ({ id: tabId })),
      onActivated: {
        addListener: vi.fn(),
      },
      onUpdated: {
        addListener: vi.fn(),
      },
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

  it("rejects stale content script ping responses without the current protocol version", async () => {
    const { PACK_CONTENT_SCRIPT_PROTOCOL_VERSION } = await import("../../src/core/messages");
    const { isCurrentContentScriptPingResponse } = await import("../../src/entrypoints/background");

    expect(isCurrentContentScriptPingResponse({ ok: true, context: null })).toBe(false);
    expect(
      isCurrentContentScriptPingResponse({
        ok: true,
        context: null,
        contentScriptVersion: PACK_CONTENT_SCRIPT_PROTOCOL_VERSION,
      }),
    ).toBe(true);
  });

  it("checks the content script protocol before sending side-effectful tab messages", async () => {
    const { PACK_CONTENT_SCRIPT_PROTOCOL_VERSION } = await import("../../src/core/messages");
    const sendMessage = browserMocks.tabs.sendMessage as unknown as {
      mockImplementation: (
        implementation: (tabId: number, message: { type: string }) => Promise<unknown>,
      ) => void;
    };
    sendMessage.mockImplementation(async (_tabId, message) => {
      if (message.type === "PACK_CONTENT_PING_V2") {
        return { ok: true, context: null };
      }
      return {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-result-view-clicked"],
          safeMessage: "Opened.",
          contentScriptVersion: PACK_CONTENT_SCRIPT_PROTOCOL_VERSION,
        },
      };
    });
    const { sendMessageToTabWithInjection } = await import("../../src/entrypoints/background");

    await sendMessageToTabWithInjection(33, {
      type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      payload: {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
    });

    expect(browserMocks.tabs.sendMessage).toHaveBeenNthCalledWith(1, 33, {
      type: "PACK_CONTENT_PING_V2",
    });
    expect(browserMocks.scripting.executeScript).toHaveBeenCalledWith({
      files: ["/content-scripts/content.js"],
      target: { tabId: 33 },
    });
    expect(browserMocks.tabs.sendMessage).toHaveBeenLastCalledWith(33, {
      type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      payload: {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
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

  it("uses the last reported GST tab when the popup is open and multiple GST tabs exist", async () => {
    browserMocks.storage.session.get.mockResolvedValueOnce({
      "pack:last-gst-tab-id": 26,
    });
    browserMocks.tabs.get.mockResolvedValueOnce({
      active: false,
      id: 26,
      url: "https://return.gst.gov.in/returns/auth/dashboard",
    });
    browserMocks.tabs.query.mockResolvedValueOnce([
      {
        active: true,
        id: 24,
        url: "chrome-extension://pack-test-extension/popup.html",
      },
    ]);
    const { getActiveGstTab } = await import("../../src/entrypoints/background");

    await expect(getActiveGstTab()).resolves.toMatchObject({ id: 26 });

    expect(browserMocks.tabs.query).toHaveBeenCalledTimes(1);
    expect(browserMocks.storage.session.get).toHaveBeenCalledWith("pack:last-gst-tab-id");
    expect(browserMocks.tabs.get).toHaveBeenCalledWith(26);
  });

  it("remembers a supported GST tab when Brave activates it", async () => {
    browserMocks.tabs.get.mockResolvedValueOnce({
      active: true,
      id: 44,
      url: "https://return.gst.gov.in/returns/auth/dashboard",
    });
    const { rememberActiveGstTabById } = await import("../../src/entrypoints/background");

    await rememberActiveGstTabById(44);

    expect(browserMocks.tabs.get).toHaveBeenCalledWith(44);
    expect(browserMocks.storage.session.set).toHaveBeenCalledWith({
      "pack:last-gst-tab-id": 44,
    });
  });

  it("does not remember a non-GST tab when Brave activates it", async () => {
    browserMocks.tabs.get.mockResolvedValueOnce({
      active: true,
      id: 45,
      url: "https://example.com/",
    });
    const { rememberActiveGstTabById } = await import("../../src/entrypoints/background");

    await rememberActiveGstTabById(45);

    expect(browserMocks.storage.session.set).not.toHaveBeenCalled();
  });

  it("registers tab activation and update listeners for GST tab memory", async () => {
    await import("../../src/entrypoints/background");

    expect(browserMocks.tabs.onActivated.addListener).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale remembered GST tab and then uses the unique best candidate", async () => {
    browserMocks.storage.session.get.mockResolvedValueOnce({
      "pack:last-gst-tab-id": 25,
    });
    browserMocks.tabs.get.mockResolvedValueOnce({
      active: false,
      id: 25,
      url: "https://example.com/",
    });
    browserMocks.tabs.query
      .mockResolvedValueOnce([
        {
          active: true,
          id: 24,
          url: "chrome-extension://pack-test-extension/popup.html",
        },
      ])
      .mockResolvedValueOnce([
        {
          active: false,
          id: 25,
          url: "https://services.gst.gov.in/services/auth/dashboard",
        },
        {
          active: false,
          id: 26,
          url: "https://return.gst.gov.in/returns/auth/efiledReturns",
        },
      ]);
    const { getActiveGstTab } = await import("../../src/entrypoints/background");

    await expect(getActiveGstTab()).resolves.toMatchObject({ id: 26 });
  });

  it("uses the unique highest-priority GST tab when the popup has multiple GST tabs", async () => {
    browserMocks.tabs.query
      .mockResolvedValueOnce([
        {
          active: true,
          id: 24,
          url: "chrome-extension://pack-test-extension/popup.html",
        },
      ])
      .mockResolvedValueOnce([
        {
          active: false,
          id: 25,
          url: "https://services.gst.gov.in/services/auth/dashboard",
        },
        {
          active: false,
          id: 26,
          url: "https://return.gst.gov.in/returns/auth/efiledReturns",
        },
      ]);
    const { getActiveGstTab } = await import("../../src/entrypoints/background");

    await expect(getActiveGstTab()).resolves.toMatchObject({ id: 26 });
  });

  it("fails closed when multiple GST tabs are equally preferred", async () => {
    browserMocks.tabs.query
      .mockResolvedValueOnce([
        {
          active: true,
          id: 24,
          url: "chrome-extension://pack-test-extension/popup.html",
        },
      ])
      .mockResolvedValueOnce([
        {
          active: false,
          id: 25,
          url: "https://return.gst.gov.in/returns/auth/dashboard",
        },
        {
          active: false,
          id: 26,
          url: "https://return.gst.gov.in/returns/auth/efiledReturns",
        },
      ]);
    const { getActiveGstTab } = await import("../../src/entrypoints/background");

    await expect(getActiveGstTab()).resolves.toBeNull();
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
