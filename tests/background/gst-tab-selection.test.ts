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
      type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
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
      type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
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

  it("fails closed when the popup tab has multiple GST tabs in the current window", async () => {
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
