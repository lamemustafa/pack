import { beforeEach, describe, expect, it, vi } from "vitest";
import { toPortalReturnPeriod } from "../../src/connectors/gst/filed-returns-return-period";
import { getFiledReturnsFullFiscalYearPeriods } from "../../src/core/filed-returns-scope";
import type { PackMessage, PackMessageResponse } from "../../src/core/messages";

const browserMocks = vi.hoisted(() => {
  let messageListener:
    | ((
        message: unknown,
        sender: Browser.runtime.MessageSender,
        sendResponse: (response: PackMessageResponse) => void,
      ) => boolean | undefined)
    | null = null;

  return {
    getMessageListener: () => messageListener,
    downloads: {
      download: vi.fn(async () => 481),
    },
    runtime: {
      id: "pack-test-extension",
      onInstalled: {
        addListener: vi.fn(),
      },
      onMessage: {
        addListener: vi.fn((listener) => {
          messageListener = listener;
        }),
      },
    },
    scripting: {
      executeScript: vi.fn(async () => []),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        remove: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
        setAccessLevel: vi.fn(async () => undefined),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
    tabs: {
      onActivated: {
        addListener: vi.fn(),
      },
      onUpdated: {
        addListener: vi.fn(),
      },
      create: vi.fn(async () => undefined),
      query: vi.fn(async () => [
        {
          active: true,
          id: 17,
          url: "https://return.gst.gov.in/returns/auth/gstr3b",
          windowId: 1,
        },
      ]),
      sendMessage: vi.fn(),
      update: vi.fn(async () => undefined),
    },
    windows: {
      update: vi.fn(async () => undefined),
    },
  };
});

vi.mock("wxt/browser", () => ({
  browser: browserMocks,
}));

vi.mock("../../src/background/download-observer", () => ({
  observeBrowserDownloadById: vi.fn(async () => ({
    state: "completed",
    safeSignals: ["browser-download-completed", "browser-download-non-empty"],
    safeMessage: "Completed.",
  })),
  observeNextBrowserDownload: vi.fn(() => ({
    promise: Promise.resolve({
      state: "completed",
      safeSignals: ["browser-download-completed", "browser-download-non-empty"],
      safeMessage: "Completed.",
    }),
    stop: vi.fn(),
  })),
  mergeFlowStepWithDownloadObservation: vi.fn((step, observation) =>
    observation.state === "completed"
      ? {
          ...step,
          state: "downloaded",
          safeSignals: [...step.safeSignals, ...observation.safeSignals],
          safeMessage: observation.safeMessage,
        }
      : {
          ...step,
          state: observation.state === "failed" ? "blocked" : "download-unconfirmed",
          safeSignals: [...step.safeSignals, ...observation.safeSignals],
          safeMessage: observation.safeMessage,
          ...(observation.userAction ? { userAction: observation.userAction } : {}),
        },
  ),
}));

vi.mock("../../src/background/download-filename-suggester", () => ({
  suggestNextBrowserDownloadFilename: vi.fn(() => ({ stop: vi.fn() })),
}));

describe("background filed returns download defaults", () => {
  const directMayUrl = "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=052026";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useRealTimers();
    vi.stubGlobal("defineBackground", (entrypoint: () => void) => {
      entrypoint();
      return entrypoint;
    });
  });

  it("prefers the direct GST PDF request before the portal download click", async () => {
    browserMocks.tabs.sendMessage.mockImplementation(async (_tabId, message: PackMessage) => {
      if (message.type === "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3") {
        return {
          ok: true,
          flowStep: {
            connectorId: "gst",
            scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
            state: "clicked",
            safeSignals: ["gstr-3b-detail-route", "filed-gstr3b-download-ready"],
            safeMessage: "Ready.",
          },
        } satisfies PackMessageResponse;
      }

      if (message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3") {
        return {
          ok: true,
          directDownloadRequest: {
            actionId: message.payload.actionId,
            safeSignals: ["filed-gstr3b-direct-download-probe-accepted"],
            url: directMayUrl,
          },
        } satisfies PackMessageResponse;
      }

      return { ok: false, error: "Unexpected message." } satisfies PackMessageResponse;
    });

    await import("../../src/entrypoints/background");

    const response = await sendBackgroundMessage({
      type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
      payload: {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining([
          "filed-gstr3b-direct-download-started",
          "browser-download-completed",
        ]),
      },
    });
    expect(browserMocks.downloads.download).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf",
      saveAs: false,
      url: directMayUrl,
    });
    expect(sentActionMessageTypes()).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3",
    ]);
  });

  it("uses direct downloads for each full-fiscal-year monthly target", async () => {
    const financialYear = "2026-27";
    const periods = getFiledReturnsFullFiscalYearPeriods(financialYear);
    const directUrlByMonth = new Map(
      periods.map((period) => [
        period,
        `https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=${toPortalReturnPeriod(period, financialYear)}`,
      ]),
    );
    browserMocks.tabs.sendMessage.mockImplementation(async (_tabId, message: PackMessage) => {
      if (message.type === "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3") {
        return {
          ok: true,
          flowStep: {
            connectorId: "gst",
            scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
            state: "clicked",
            safeSignals: [
              "gstr-3b-detail-route",
              "filed-gstr3b-download-ready",
              `filed-return-detail-period:${message.payload.period}`,
            ],
            safeMessage: "Ready.",
          },
        } satisfies PackMessageResponse;
      }

      if (message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3") {
        const period = periods.find((candidate) => candidate === message.payload.period);
        const periodDirectUrl = period ? directUrlByMonth.get(period) : null;
        return {
          ok: true,
          directDownloadRequest: {
            actionId: message.payload.actionId,
            safeSignals: ["filed-gstr3b-direct-download-probe-accepted"],
            url: periodDirectUrl ?? directMayUrl,
          },
        } satisfies PackMessageResponse;
      }

      return { ok: false, error: "Unexpected message." } satisfies PackMessageResponse;
    });

    await import("../../src/entrypoints/background");

    const response = await sendBackgroundMessage({
      type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
      payload: {
        financialYear,
        period: "FULL_FISCAL_YEAR",
        returnType: "GSTR-3B",
      },
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining(["full-fiscal-year-complete"]),
      },
      flowSummary: {
        completedPeriods: periods,
        status: "complete",
        totalPeriods: periods.length,
      },
    });
    expect(browserMocks.downloads.download).toHaveBeenCalledTimes(periods.length);
    periods.forEach((period, index) => {
      expect(browserMocks.downloads.download).toHaveBeenNthCalledWith(index + 1, {
        conflictAction: "uniquify",
        filename: `complyeaze-pack/gst/${financialYear}/gstr-3b/${period.toLowerCase()}.pdf`,
        saveAs: false,
        url: directUrlByMonth.get(period),
      });
    });
    expect(sentActionMessageTypes()).toEqual([
      ...periods.flatMap(() => [
        "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
        "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3",
      ]),
    ]);
  });

  it("does not use the GSTR-3B direct-download resolver for GSTR-2B", async () => {
    browserMocks.tabs.sendMessage.mockImplementation(async (_tabId, message: PackMessage) => {
      if (message.type === "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3") {
        return {
          ok: true,
          flowStep: {
            connectorId: "gst",
            scopeId: "gst-gstr2b-private-v0",
            state: "ready",
            safeSignals: [
              "gstr2b-summary-route",
              "gstr2b-download-ready",
              "filed-return-download-ready",
            ],
            safeMessage: "Ready.",
          },
        } satisfies PackMessageResponse;
      }

      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        return {
          ok: true,
          downloadTrigger: {
            connectorId: "gst",
            scopeId: "gst-gstr2b-private-v0",
            state: "clicked",
            safeSignals: ["gstr2b-download-clicked", "gstr2b-portal-blob-download-clicked"],
            safeMessage: "Clicked.",
          },
        } satisfies PackMessageResponse;
      }

      return { ok: false, error: "Unexpected message." } satisfies PackMessageResponse;
    });

    await import("../../src/entrypoints/background");

    const response = await sendBackgroundMessage({
      type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
      payload: {
        artifactType: "EXCEL",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      },
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining([
          "gstr2b-portal-blob-download-clicked",
          "browser-download-completed",
        ]),
      },
    });
    expect(browserMocks.downloads.download).not.toHaveBeenCalled();
    expect(sentActionMessageTypes()).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
  });
});

async function sendBackgroundMessage(message: PackMessage): Promise<PackMessageResponse> {
  const listener = browserMocks.getMessageListener();
  if (!listener) throw new Error("background listener was not registered");

  return new Promise((resolve) => {
    listener(
      message,
      { id: browserMocks.runtime.id } satisfies Browser.runtime.MessageSender,
      resolve,
    );
  });
}

function sentActionMessageTypes(): string[] {
  return browserMocks.tabs.sendMessage.mock.calls
    .map(([, message]) => message.type)
    .filter((type) => type !== "PACK_CONTENT_PING_V2");
}
