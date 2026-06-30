import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackMessageResponse } from "../../src/core/messages";
import {
  FULL_FISCAL_YEAR_PERIOD,
  type FiledReturnsMonth,
} from "../../src/core/filed-returns-scope";
import type { FiledReturnsFullFiscalYearLedger } from "../../src/core/contracts";
import {
  retryFullFiscalYearTargetDownloadFlow,
  startFiledReturnsDownloadFlow,
  type ActiveGstTab,
  type FiledReturnsFlowRunnerDeps,
} from "../../src/background/filed-returns-flow-runner";
import {
  observeBrowserDownloadById,
  observeNextBrowserDownload,
} from "../../src/background/download-observer";
import { suggestNextBrowserDownloadFilename } from "../../src/background/download-filename-suggester";
import { browser } from "wxt/browser";

vi.mock("wxt/browser", () => ({
  browser: {
    downloads: {
      download: vi.fn(async () => 81),
    },
    storage: {
      session: {
        set: vi.fn(async () => undefined),
      },
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
    },
    tabs: {
      create: vi.fn(async () => undefined),
      goBack: vi.fn(async () => undefined),
      query: vi.fn(async () => []),
      update: vi.fn(async () => undefined),
    },
    windows: {
      update: vi.fn(async () => undefined),
    },
  },
}));

vi.mock("../../src/background/download-observer", () => ({
  observeBrowserDownloadById: vi.fn(() =>
    Promise.resolve({
      state: "completed",
      safeSignals: ["browser-download-completed", "browser-download-non-empty"],
      safeMessage: "Completed.",
    }),
  ),
  observeNextBrowserDownload: vi.fn(() => ({
    promise: Promise.resolve({
      state: "completed",
      safeSignals: ["browser-download-completed"],
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

const ACTIVE_GST_TAB = {
  id: 17,
  active: true,
  highlighted: true,
  incognito: false,
  index: 0,
  pinned: false,
  selected: true,
  windowId: 1,
  url: "https://return.gst.gov.in/returns/auth/efiledReturns",
} as ActiveGstTab;

describe("filed returns flow runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(observeNextBrowserDownload).mockReturnValue({
      promise: Promise.resolve({
        state: "completed",
        safeSignals: ["browser-download-completed", "browser-download-non-empty"],
        safeMessage: "Completed.",
      }),
      stop: vi.fn(),
    });
    mockLocalStorageGet({});
  });

  it("runs a full fiscal year through concrete monthly targets without sending a full-year sentinel to content", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnRowOpened("April"),
      filedReturnDownloadClicked(),
      filedReturnRowOpened("May"),
      filedReturnDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-06-24T00:00:00+05:30"),
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining(["full-fiscal-year-complete"]),
      },
      flowSummary: {
        status: "complete",
        completedPeriods: ["April", "May"],
        totalPeriods: 2,
      },
    });
    expect(browser.tabs.goBack).not.toHaveBeenCalled();
    const sentPeriods = sendMessageToTabWithInjection.mock.calls.map(
      ([, message]) => message.payload.period,
    );
    const sentTypes = sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type);
    expect(sentPeriods).toEqual(["April", "April", "May", "May"]);
    expect(sentPeriods).not.toContain(FULL_FISCAL_YEAR_PERIOD);
    expect(sentPeriods).not.toContain("ALL");
    expect(sentTypes).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V2",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V2",
    ]);
    expect(suggestNextBrowserDownloadFilename).toHaveBeenCalledWith(
      browser.downloads,
      expect.objectContaining({
        expectedMimeTypes: ["application/pdf"],
        expectedOrigins: expect.arrayContaining(["https://return.gst.gov.in"]),
      }),
      "complyeaze-pack/gst/2026-27/gstr-3b/april.pdf",
    );
    expect(suggestNextBrowserDownloadFilename).toHaveBeenCalledWith(
      browser.downloads,
      expect.objectContaining({
        expectedMimeTypes: ["application/pdf"],
        expectedOrigins: expect.arrayContaining(["https://return.gst.gov.in"]),
      }),
      "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf",
    );
    expect(observeNextBrowserDownload).toHaveBeenCalledWith(
      browser.downloads,
      expect.objectContaining({
        ignoredFilenames: ["complyeaze-pack/gst/2026-27/gstr-3b/april.pdf"],
      }),
    );
    expect(observeNextBrowserDownload).toHaveBeenCalledWith(
      browser.downloads,
      expect.objectContaining({
        ignoredFilenames: ["complyeaze-pack/gst/2026-27/gstr-3b/may.pdf"],
      }),
    );
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        completedAt: expect.any(String),
        scope: {
          financialYear: "2026-27",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
        status: "complete",
        completedPeriods: ["April", "May"],
        totalPeriods: 2,
        flowStep: expect.objectContaining({
          safeSignals: expect.arrayContaining(["full-fiscal-year-complete"]),
        }),
      }),
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        status: "complete",
        targets: [
          expect.objectContaining({ period: "April", status: "downloaded" }),
          expect.objectContaining({ period: "May", status: "downloaded" }),
        ],
      }),
    });
  });

  it("uses the direct GST PDF endpoint before clicking the portal download control", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      {
        ok: true,
        directDownloadRequest: {
          actionId: "action-direct",
          url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=052026",
          safeSignals: ["filed-gstr3b-direct-download-path-built"],
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        "directDownloadRequest" in response &&
        message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V2"
      ) {
        response.directDownloadRequest.actionId = message.payload.actionId;
      }
      return response;
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        preferDirectDownload: true,
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

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
    expect(browser.downloads.download).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf",
      saveAs: false,
      url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=052026",
    });
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
      "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V2",
    ]);
  });

  it("persists a single-period download result for popup status", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      filedReturnDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-06-24T00:00:00.000Z"),
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        completedAt: "2026-06-24T00:00:00.000Z",
        completedPeriods: ["May"],
        currentPeriod: "May",
        status: "complete",
        scope: {
          financialYear: "2026-27",
          period: "May",
          returnType: "GSTR-3B",
        },
        flowStep: expect.objectContaining({
          state: "downloaded",
          safeSignals: expect.arrayContaining(["filed-gstr3b-download-clicked"]),
        }),
        totalPeriods: 1,
      }),
    });
    expect(response).toMatchObject({
      ok: true,
      flowSummary: expect.objectContaining({
        completedPeriods: ["May"],
        currentPeriod: "May",
        status: "complete",
        totalPeriods: 1,
      }),
    });
  });

  it("returns a blocked single-period summary for immediate popup updates", async () => {
    vi.mocked(observeNextBrowserDownload).mockReturnValueOnce({
      promise: Promise.resolve({
        state: "not-observed",
        safeSignals: ["browser-download-not-observed"],
        safeMessage: "No browser completion.",
      }),
      stop: vi.fn(),
    });
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      filedReturnDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
          targetReview: "target-review",
        },
        now: () => new Date("2026-06-24T00:00:00.000Z"),
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "download-unconfirmed",
      },
      flowSummary: {
        completedPeriods: [],
        currentPeriod: "May",
        flowStep: {
          state: "user-action-required",
          safeSignals: ["filed-returns-target-review-required"],
          userAction: {
            type: "RETRY_PORTAL_GENERATION",
          },
        },
        status: "blocked",
        totalPeriods: 1,
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        currentPeriod: "May",
        status: "blocked",
        flowStep: expect.objectContaining({
          safeSignals: ["filed-returns-target-review-required"],
          userAction: {
            type: "RETRY_PORTAL_GENERATION",
            message: expect.any(String),
            canResume: true,
          },
        }),
      }),
    });
  });

  it("explains when a direct download is waiting on the browser native Save prompt", async () => {
    vi.mocked(observeBrowserDownloadById).mockResolvedValueOnce({
      state: "not-observed",
      safeSignals: ["browser-download-not-observed"],
      safeMessage: "No browser completion.",
      userAction: {
        type: "ALLOW_MULTIPLE_DOWNLOADS",
        message: "Allow downloads.",
        canResume: true,
      },
    });
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      {
        ok: true,
        directDownloadRequest: {
          actionId: "action-direct",
          url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=052026",
          safeSignals: ["filed-gstr3b-direct-download-path-built"],
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        "directDownloadRequest" in response &&
        message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V2"
      ) {
        response.directDownloadRequest.actionId = message.payload.actionId;
      }
      return response;
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        preferDirectDownload: true,
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
          targetReview: "target-review",
        },
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "download-unconfirmed",
        safeSignals: expect.arrayContaining([
          "filed-gstr3b-direct-download-started",
          "browser-download-prompt-may-be-enabled",
        ]),
        safeMessage: expect.stringContaining("native Save dialog"),
        userAction: {
          type: "ALLOW_MULTIPLE_DOWNLOADS",
          message: expect.stringContaining("asks where to save"),
        },
      },
      flowSummary: {
        status: "blocked",
        completedPeriods: [],
        currentPeriod: "May",
        flowStep: {
          state: "user-action-required",
          safeSignals: ["filed-returns-target-review-required"],
        },
      },
    });
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        currentPeriod: "May",
        status: "blocked",
        flowStep: expect.objectContaining({
          safeSignals: ["filed-returns-target-review-required"],
        }),
      }),
    });
    expect(observeBrowserDownloadById).toHaveBeenCalledWith(
      browser.downloads,
      81,
      expect.objectContaining({
        expectedUrlSubstrings: ["rtn_prd=052026"],
      }),
    );
  });

  it("falls back to the portal click when the direct GST PDF endpoint is unavailable", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "candidate-not-found",
          safeSignals: ["filed-gstr3b-direct-download-path-unavailable"],
          safeMessage: "Direct endpoint unavailable.",
        },
      },
      filedReturnDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        preferDirectDownload: true,
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
      "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V2",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V2",
    ]);
  });

  it("blocks instead of falling back to the portal click when Chrome rejects the direct download start", async () => {
    vi.mocked(browser.downloads.download).mockImplementationOnce(async () => {
      throw new Error("downloads api rejected");
    });
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      {
        ok: true,
        directDownloadRequest: {
          actionId: "action-direct",
          url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=052026",
          safeSignals: ["filed-gstr3b-direct-download-path-built"],
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        "directDownloadRequest" in response &&
        message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V2"
      ) {
        response.directDownloadRequest.actionId = message.payload.actionId;
      }
      return response;
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        preferDirectDownload: true,
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining(["filed-gstr3b-direct-download-start-rejected"]),
      },
    });
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
      "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V2",
    ]);
  });

  it("blocks a direct filed-return download URL outside the reviewed GST origins", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      {
        ok: true,
        directDownloadRequest: {
          actionId: "action-direct",
          url: "https://example.com/not-gst.pdf",
          safeSignals: ["filed-gstr3b-direct-download-path-built"],
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        "directDownloadRequest" in response &&
        message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V2"
      ) {
        response.directDownloadRequest.actionId = message.payload.actionId;
      }
      return response;
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        preferDirectDownload: true,
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining(["filed-gstr3b-direct-download-origin-rejected"]),
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
  });

  it("blocks a direct filed-return download URL with an unreviewed GST path", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      {
        ok: true,
        directDownloadRequest: {
          actionId: "action-direct",
          url: "https://return.gst.gov.in/returns/auth/gstr3b/getgenpdf?rtn_prd=052026",
          safeSignals: ["filed-gstr3b-direct-download-path-built"],
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        "directDownloadRequest" in response &&
        message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V2"
      ) {
        response.directDownloadRequest.actionId = message.payload.actionId;
      }
      return response;
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        preferDirectDownload: true,
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining(["filed-gstr3b-direct-download-url-mismatch"]),
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
  });

  it("blocks a direct filed-return download URL for a different return period", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      {
        ok: true,
        directDownloadRequest: {
          actionId: "action-direct",
          url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=042026",
          safeSignals: ["filed-gstr3b-direct-download-path-built"],
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        "directDownloadRequest" in response &&
        message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V2"
      ) {
        response.directDownloadRequest.actionId = message.payload.actionId;
      }
      return response;
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        preferDirectDownload: true,
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining(["filed-gstr3b-direct-download-url-mismatch"]),
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
  });

  it("explicitly resumes a persisted full fiscal year ledger without repeating a downloaded period", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        targets: [
          { period: "April", status: "downloaded" },
          { period: "May", status: "pending" },
        ],
      }),
    });
    const responses: PackMessageResponse[] = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-result-view-clicked", "filed-return-result-period:May"],
          safeMessage: "Opened.",
        },
      },
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-gstr3b-download-clicked"],
          safeMessage: "Clicked download.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await retryFullFiscalYearTargetDownloadFlow(
      {
        ledgerId: "ledger-existing",
        targetId: "GSTR-3B:2026-27:May",
        expectedRevision: 1,
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
          targetReview: "target-review",
        },
        now: () => new Date("2026-06-24T00:00:00+05:30"),
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining(["full-fiscal-year-complete"]),
      },
    });
    const sentPeriods = sendMessageToTabWithInjection.mock.calls.map(
      ([, message]) => message.payload.period,
    );
    expect(sentPeriods).toEqual(["May", "May"]);
  });

  it("suppresses duplicate full fiscal year starts while a ledger is already running", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "running",
        currentPeriod: "April",
        targets: [
          { period: "April", status: "running" },
          { period: "May", status: "pending" },
        ],
      }),
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-06-24T00:00:00+05:30"),
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["full-fiscal-year-run-active"]),
      },
      flowSummary: {
        status: "running",
        currentPeriod: "April",
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  });

  it("does not auto-resume a stale running full fiscal year ledger after service-worker restart", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "running",
        currentPeriod: "April",
        updatedAt: "2026-06-23T18:29:00.000Z",
        targets: [{ period: "April", status: "running" }],
      }),
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-06-24T00:00:00+05:30"),
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["full-fiscal-year-run-interrupted"]),
      },
      flowSummary: {
        status: "blocked",
        currentPeriod: "April",
        totalPeriods: 2,
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  });

  it("blocks a new run while a persisted active run exists", async () => {
    mockLocalStorageGet({
      "active-run": {
        schemaVersion: "1.0",
        runId: "run-existing",
        revision: 1,
        scope: {
          financialYear: "2026-27",
          period: "April",
          returnType: "GSTR-3B",
        },
        status: "running",
        leaseUpdatedAt: "2026-06-24T00:00:00.000Z",
      },
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          activeRun: "active-run",
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-06-24T00:00:05.000Z"),
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["filed-returns-run-active"],
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  });

  it("does not retry a single-period target with unresolved download evidence through normal start", async () => {
    mockLocalStorageGet({
      "target-review": {
        schemaVersion: "1.0",
        targetId: "GSTR-3B:2025-26:March",
        status: "download-unconfirmed",
        scope: {
          financialYear: "2025-26",
          period: "March",
          returnType: "GSTR-3B",
        },
        safeSignals: ["browser-download-size-unknown"],
        safeMessage: "Pack could not confirm the browser download for March.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
          targetReview: "target-review",
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["filed-returns-target-review-required"],
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  });

  it("stops a full fiscal year run on an unconfirmed download and persists the blocked target", async () => {
    vi.mocked(observeNextBrowserDownload).mockReturnValue({
      promise: Promise.resolve({
        state: "not-observed",
        safeSignals: ["browser-download-size-unknown"],
        safeMessage: "Unconfirmed.",
        userAction: {
          type: "RETRY_PORTAL_GENERATION",
          message: "Retry.",
          canResume: true,
        },
      }),
      stop: vi.fn(),
    });
    const responses: PackMessageResponse[] = [
      filedReturnRowOpened("April"),
      filedReturnDownloadClicked(),
      filedReturnRowOpened("May"),
      filedReturnDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
          targetReview: "target-review",
        },
        now: () => new Date("2026-06-24T00:00:00+05:30"),
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "download-unconfirmed",
        safeSignals: expect.arrayContaining(["browser-download-size-unknown"]),
      },
      flowSummary: {
        status: "blocked",
        completedPeriods: [],
        currentPeriod: "April",
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(2);
    expect(browser.storage.session.set).not.toHaveBeenCalledWith({
      completion: expect.anything(),
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        status: "blocked",
        targets: expect.arrayContaining([
          expect.objectContaining({ period: "April", status: "download-unconfirmed" }),
          expect.objectContaining({ period: "May", status: "pending" }),
        ]),
      }),
    });
    expect(browser.storage.local.set).not.toHaveBeenCalledWith({
      "target-review": expect.anything(),
    });
  });

  it("does not persist raw failure messages into the full-year ledger", async () => {
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => ({
      ok: false,
      error: "Could not reach https://return.gst.gov.in/returns/auth/gstr3b?token=secret",
    }));

    await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-06-24T00:00:00+05:30"),
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    const persistedLedgers = vi
      .mocked(browser.storage.local.set)
      .mock.calls.map(([value]) => (value as Record<string, unknown>)["full-year-ledger"])
      .filter(Boolean) as FiledReturnsFullFiscalYearLedger[];
    const lastLedger = persistedLedgers.at(-1);

    expect(lastLedger?.targets[0]).toMatchObject({
      status: "failed",
      safeSignals: expect.arrayContaining(["pack-error:CONTENT_SCRIPT_UNAVAILABLE"]),
    });
    expect(lastLedger?.targets[0]?.safeMessage).not.toContain("https://");
    expect(lastLedger?.targets[0]?.safeMessage).not.toContain("secret");
  });

  it("does not retry an unconfirmed full-year target through a normal start", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "blocked",
        currentPeriod: "April",
        targets: [
          { period: "April", status: "download-unconfirmed" },
          { period: "May", status: "pending" },
        ],
      }),
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-06-24T00:00:00+05:30"),
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["full-fiscal-year-download-unconfirmed"]),
      },
      flowSummary: {
        status: "blocked",
        currentPeriod: "April",
        fullFiscalYearRecovery: {
          ledgerId: "ledger-existing",
          targetId: "GSTR-3B:2026-27:April",
          expectedRevision: 1,
          targetStatus: "download-unconfirmed",
        },
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before resuming an existing pending full-year ledger", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "running",
        currentPeriod: "May",
        targets: [
          { period: "April", status: "downloaded" },
          { period: "May", status: "pending" },
        ],
      }),
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-06-24T00:00:00+05:30"),
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: ["full-fiscal-year-resume-confirmation-required"],
      },
      flowSummary: {
        status: "running",
        completedPeriods: ["April"],
        currentPeriod: "May",
        fullFiscalYearRecovery: {
          ledgerId: "ledger-existing",
          targetId: "GSTR-3B:2026-27:May",
          expectedRevision: 1,
          targetStatus: "pending",
        },
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  });

  it("starts a clean run instead of reusing a completed same-scope full-year ledger", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "complete",
        targets: [
          { period: "April", status: "downloaded" },
          { period: "May", status: "downloaded" },
        ],
      }),
    });
    const responses: PackMessageResponse[] = [
      filedReturnRowOpened("April"),
      filedReturnDownloadClicked(),
      filedReturnRowOpened("May"),
      filedReturnDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-06-24T00:00:00+05:30"),
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining(["full-fiscal-year-complete"]),
      },
      flowSummary: {
        status: "complete",
        completedPeriods: ["April", "May"],
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(4);
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        ledgerId: expect.not.stringMatching(/^ledger-existing$/),
        status: "complete",
        targets: [
          expect.objectContaining({ period: "April", status: "downloaded" }),
          expect.objectContaining({ period: "May", status: "downloaded" }),
        ],
      }),
    });
  });

  it("starts a clean current-year run when a completed ledger gains a newly eligible month", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "complete",
        targets: [
          { period: "April", status: "downloaded" },
          { period: "May", status: "downloaded" },
        ],
      }),
    });
    const responses: PackMessageResponse[] = [
      filedReturnRowOpened("April"),
      filedReturnDownloadClicked(),
      filedReturnRowOpened("May"),
      filedReturnDownloadClicked(),
      filedReturnRowOpened("June"),
      filedReturnDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-07-02T00:00:00+05:30"),
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowSummary: {
        status: "complete",
        completedPeriods: ["April", "May", "June"],
        totalPeriods: 3,
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(6);
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        ledgerId: expect.not.stringMatching(/^ledger-existing$/),
        status: "complete",
        targets: [
          expect.objectContaining({ period: "April", status: "downloaded" }),
          expect.objectContaining({ period: "May", status: "downloaded" }),
          expect.objectContaining({ period: "June", status: "downloaded" }),
        ],
      }),
    });
  });

  it.each(["blocked", "failed", "cancelled"] as const)(
    "does not retry a %s full-year target through a normal start",
    async (targetStatus) => {
      mockLocalStorageGet({
        "full-year-ledger": createFullFiscalYearLedger({
          status: targetStatus === "cancelled" ? "cancelled" : "blocked",
          currentPeriod: "April",
          targets: [
            { period: "April", status: targetStatus },
            { period: "May", status: "downloaded" },
          ],
        }),
      });
      const sendMessageToTabWithInjection =
        vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

      const response = await startFiledReturnsDownloadFlow(
        {
          financialYear: "2026-27",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
        {
          getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
          sendMessageToTabWithInjection,
          storageKeys: {
            completion: "completion",
            fullFiscalYearLedger: "full-year-ledger",
            observation: "observation",
          },
          now: () => new Date("2026-06-24T00:00:00+05:30"),
        },
      );

      expect(response).toMatchObject({
        ok: true,
        flowStep: {
          state: "blocked",
          safeSignals: expect.arrayContaining(["full-fiscal-year-run-needs-action"]),
        },
        flowSummary: {
          status: targetStatus === "cancelled" ? "cancelled" : "blocked",
          completedPeriods: ["May"],
          totalPeriods: 2,
          fullFiscalYearRecovery: {
            ledgerId: "ledger-existing",
            targetId: "GSTR-3B:2026-27:April",
            expectedRevision: 1,
            targetStatus,
          },
        },
      });
      expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
      expect(browser.storage.local.set).not.toHaveBeenCalledWith({
        "full-year-ledger": expect.objectContaining({ status: "complete" }),
      });
    },
  );

  it("persists current-year reconciliation before returning a resume-confirmation summary", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "blocked",
        currentPeriod: "May",
        updatedAt: "2026-06-24T00:00:00.000Z",
        targets: [
          { period: "April", status: "downloaded" },
          { period: "May", status: "blocked" },
        ],
      }),
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-07-02T00:00:00+05:30"),
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining(["full-fiscal-year-resume-confirmation-required"]),
      },
      flowSummary: {
        status: "blocked",
        totalPeriods: 3,
        fullFiscalYearRecovery: {
          targetId: "GSTR-3B:2026-27:May",
          targetStatus: "blocked",
        },
      },
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        revision: 2,
        lastReconciledAt: "2026-07-01T18:30:00.000Z",
        targets: expect.arrayContaining([expect.objectContaining({ period: "June" })]),
      }),
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  });

  it("does not trust a stale complete ledger when a target is not successful", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "complete",
        currentPeriod: "April",
        targets: [
          { period: "April", status: "cancelled" },
          { period: "May", status: "downloaded" },
        ],
      }),
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-06-24T00:00:00+05:30"),
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining(["full-fiscal-year-run-needs-action"]),
      },
      flowSummary: {
        status: "blocked",
        completedPeriods: ["May"],
        totalPeriods: 2,
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  });

  it("does not mutate a retry target when another run is active", async () => {
    mockLocalStorageGet({
      "active-run": {
        schemaVersion: "1.0",
        runId: "run-existing",
        revision: 1,
        scope: {
          financialYear: "2026-27",
          period: "May",
          returnType: "GSTR-3B",
        },
        status: "running",
        leaseUpdatedAt: "2026-06-24T00:00:00.000Z",
      },
      "full-year-ledger": createFullFiscalYearLedger({
        status: "blocked",
        currentPeriod: "April",
        targets: [{ period: "April", status: "blocked" }],
      }),
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await retryFullFiscalYearTargetDownloadFlow(
      {
        ledgerId: "ledger-existing",
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 1,
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          activeRun: "active-run",
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
          targetReview: "target-review",
        },
        now: () => new Date("2026-06-24T00:00:05.000Z"),
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["filed-returns-run-active"],
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
    expect(browser.storage.local.set).not.toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        targets: [expect.objectContaining({ status: "pending" })],
      }),
    });
  });

  it("explicitly resumes a reconciled current-year ledger with newly eligible periods", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "running",
        currentPeriod: "June",
        updatedAt: "2026-07-02T00:00:00.000Z",
        targets: [
          { period: "April", status: "downloaded" },
          { period: "May", status: "downloaded" },
          { period: "June", status: "pending" },
        ],
      }),
    });
    const responses: PackMessageResponse[] = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-result-view-clicked", "filed-return-result-period:June"],
          safeMessage: "Opened.",
        },
      },
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-gstr3b-download-clicked"],
          safeMessage: "Clicked download.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await retryFullFiscalYearTargetDownloadFlow(
      {
        ledgerId: "ledger-existing",
        targetId: "GSTR-3B:2026-27:June",
        expectedRevision: 1,
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
          targetReview: "target-review",
        },
        now: () => new Date("2026-07-02T00:00:00+05:30"),
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowSummary: {
        status: "complete",
        completedPeriods: ["April", "May", "June"],
        totalPeriods: 3,
      },
    });
    const sentPeriods = sendMessageToTabWithInjection.mock.calls.map(
      ([, message]) => message.payload.period,
    );
    expect(sentPeriods).toEqual(["June", "June"]);
  });

  it("keeps the observer alive after an ambiguous final trigger delivery", async () => {
    const responses: Array<PackMessageResponse | Error> = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-result-view-clicked", "filed-return-result-period:March"],
          safeMessage: "Opened.",
        },
      },
      new Error("Could not establish connection. Receiving end does not exist."),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => {
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response ?? { ok: false, error: "Unexpected call." };
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "download-unconfirmed",
        safeSignals: expect.arrayContaining([
          "filed-gstr3b-download-trigger-ambiguous",
          "browser-download-completed",
        ]),
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(2);
    expect(sendMessageToTabWithInjection).toHaveBeenLastCalledWith(17, {
      type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V2",
      payload: expect.objectContaining({
        actionId: expect.any(String),
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      }),
    });
    expect(observeNextBrowserDownload).toHaveBeenCalledTimes(1);
  }, 12_000);

  it("treats API result form post as filed-return detail navigation", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnApiResultPosted("March"),
      filedReturnDownloadReady("March"),
      filedReturnDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        timings: {
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining([
          "filed-gstr3b-download-clicked",
          "browser-download-completed",
          "browser-download-non-empty",
        ]),
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(3);
    expect(sendMessageToTabWithInjection).toHaveBeenNthCalledWith(2, 17, {
      type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
      payload: {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenLastCalledWith(17, {
      type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V2",
      payload: expect.objectContaining({
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      }),
    });
  });

  it("starts a direct download after API detail handoff lands on a blank GSTR-3B route", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnApiResultPosted("March"),
      blankGstr3bDetailRoute(),
      {
        ok: true,
        directDownloadRequest: {
          actionId: "action-direct",
          url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=032026",
          safeSignals: [
            "gstr-3b-detail-route",
            "filed-gstr3b-direct-download-storage-period-matched",
            "filed-gstr3b-direct-download-path-built",
          ],
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        "directDownloadRequest" in response &&
        message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V2"
      ) {
        response.directDownloadRequest.actionId = message.payload.actionId;
      }
      return response;
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        preferDirectDownload: true,
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining([
          "filed-gstr3b-direct-download-started",
          "browser-download-completed",
          "browser-download-non-empty",
        ]),
      },
    });
    expect(browser.downloads.download).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "complyeaze-pack/gst/2025-26/gstr-3b/march.pdf",
      saveAs: false,
      url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=032026",
    });
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
      "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V2",
    ]);
  });

  it("continues after the known GSTR-3B summary modal appears during API detail navigation", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnApiResultPosted("March"),
      filedReturnSummaryModalOpen(),
      filedReturnDownloadReady("March"),
      filedReturnDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining([
          "filed-gstr3b-download-clicked",
          "browser-download-completed",
          "browser-download-non-empty",
        ]),
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(4);
    expect(sendMessageToTabWithInjection).toHaveBeenNthCalledWith(3, 17, {
      type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
      payload: {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenLastCalledWith(17, {
      type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V2",
      payload: expect.objectContaining({
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      }),
    });
  });

  it("persists unresolved single-period download evidence for explicit recovery", async () => {
    vi.mocked(observeNextBrowserDownload).mockReturnValue({
      promise: Promise.resolve({
        state: "not-observed",
        safeSignals: ["browser-download-size-unknown"],
        safeMessage: "Unconfirmed.",
        userAction: {
          type: "RETRY_PORTAL_GENERATION",
          message: "Retry.",
          canResume: true,
        },
      }),
      stop: vi.fn(),
    });
    const responses: PackMessageResponse[] = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-result-view-clicked", "filed-return-result-period:March"],
          safeMessage: "Opened.",
        },
      },
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-gstr3b-download-clicked"],
          safeMessage: "Clicked download.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
          targetReview: "target-review",
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "download-unconfirmed",
      },
      flowSummary: {
        status: "blocked",
        completedPeriods: [],
        currentPeriod: "March",
        flowStep: {
          state: "user-action-required",
          safeSignals: ["filed-returns-target-review-required"],
        },
      },
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "target-review": expect.objectContaining({
        targetId: "GSTR-3B:2025-26:March",
        status: "download-unconfirmed",
        scope: {
          financialYear: "2025-26",
          period: "March",
          returnType: "GSTR-3B",
        },
      }),
    });
  });

  it("does not arm a browser download observer before the final explicit trigger", async () => {
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => ({
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "user-action-required",
        safeSignals: ["filed-return-result-row-not-found"],
        safeMessage: "No matching row.",
      },
    }));

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
      },
      flowSummary: {
        currentPeriod: "March",
        status: "blocked",
        totalPeriods: 1,
      },
    });
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        currentPeriod: "March",
        status: "blocked",
        flowStep: expect.objectContaining({
          safeSignals: ["filed-return-result-row-not-found"],
        }),
      }),
    });
    expect(observeNextBrowserDownload).not.toHaveBeenCalled();
  });

  it("opens the login page instead of silently switching to another GST tab", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValueOnce([
      {
        id: 42,
        active: true,
        highlighted: true,
        incognito: false,
        index: 0,
        pinned: false,
        selected: true,
        windowId: 2,
        url: "https://return.gst.gov.in/returns/auth/efiledReturns",
      } as ActiveGstTab,
    ] as never);
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => null),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "login-required",
        safeSignals: ["gst-login-tab-opened"],
      },
      flowSummary: {
        currentPeriod: "March",
        status: "blocked",
        totalPeriods: 1,
      },
    });
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        currentPeriod: "March",
        status: "blocked",
        flowStep: expect.objectContaining({
          safeSignals: ["gst-login-tab-opened"],
        }),
      }),
    });
    expect(browser.tabs.create).toHaveBeenCalledWith({
      active: true,
      url: "https://services.gst.gov.in/services/login",
    });
    expect(browser.tabs.query).not.toHaveBeenCalled();
    expect(browser.tabs.update).not.toHaveBeenCalledWith(42, { active: true });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  });

  it("retries a non-download flow step when GST navigation temporarily disconnects the content script", async () => {
    const responses: Array<PackMessageResponse | Error> = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-detail-back-clicked"],
          safeMessage: "Returned.",
        },
      },
      new Error("Could not establish connection. Receiving end does not exist."),
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "downloaded",
          safeSignals: ["single-period-terminal-download"],
          safeMessage: "Complete.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => {
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response ?? { ok: false, error: "Unexpected call." };
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: ["single-period-terminal-download"],
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(3);
  });

  it("stops after API detail handoff if the portal reports scheduled downtime", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnApiResultPosted("March"),
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "blocked",
          safeSignals: ["portal-scheduled-downtime"],
          safeMessage: "The GST portal is in scheduled downtime.",
          userAction: {
            type: "WAIT_FOR_PORTAL_AVAILABILITY",
            message: "Wait until the GST scheduled downtime window is over, then reopen Pack.",
            canResume: true,
          },
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: ["portal-scheduled-downtime"],
      },
      flowSummary: {
        currentPeriod: "March",
        status: "blocked",
        totalPeriods: 1,
        flowStep: {
          state: "blocked",
          safeSignals: ["portal-scheduled-downtime"],
        },
      },
    });
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        currentPeriod: "March",
        status: "blocked",
        flowStep: expect.objectContaining({
          safeSignals: ["portal-scheduled-downtime"],
        }),
      }),
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(2);
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
    ]);
  });
});

function filedReturnRowOpened(period: FiledReturnsMonth): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "clicked",
      safeSignals: ["filed-return-result-view-clicked", `filed-return-result-period:${period}`],
      safeMessage: "Opened.",
    },
  };
}

function filedReturnApiResultPosted(period: FiledReturnsMonth): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "clicked",
      safeSignals: ["filed-return-api-result-posted", `filed-return-result-period:${period}`],
      safeMessage: "Opened.",
    },
  };
}

function filedReturnDownloadReady(period: FiledReturnsMonth): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "ready",
      safeSignals: ["filed-gstr3b-download-ready", `filed-return-detail-period:${period}`],
      safeMessage: "Ready.",
    },
  };
}

function blankGstr3bDetailRoute(): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "user-action-required",
      safeSignals: ["gstr-3b-detail-route", "filed-returns-heading"],
      safeMessage: "The filed returns page is visible, but GSTR-3B is not visible yet.",
    },
  };
}

function filedReturnSummaryModalOpen(): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "user-action-required",
      safeSignals: ["gstr-3b-detail-route", "detail-summary-modal"],
      safeMessage: "Summary modal is open.",
    },
  };
}

function filedReturnDownloadClicked(): PackMessageResponse {
  return {
    ok: true,
    downloadTrigger: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "clicked",
      safeSignals: ["filed-gstr3b-download-clicked"],
      safeMessage: "Clicked download.",
    },
  };
}

function createFullFiscalYearLedger({
  currentPeriod = "May",
  status = "blocked",
  targets,
  updatedAt = "2026-06-24T00:00:00.000Z",
}: {
  currentPeriod?: FiledReturnsMonth;
  status?: FiledReturnsFullFiscalYearLedger["status"];
  targets?: Array<{
    period: FiledReturnsMonth;
    status: FiledReturnsFullFiscalYearLedger["targets"][number]["status"];
  }>;
  updatedAt?: string;
} = {}): FiledReturnsFullFiscalYearLedger {
  const now = "2026-06-24T00:00:00.000Z";
  const ledgerTargets = (
    targets ?? [
      { period: "April", status: "downloaded" },
      { period: "May", status: "blocked" },
    ]
  ).map((target) => ({
    targetId: `GSTR-3B:2026-27:${target.period}`,
    financialYear: "2026-27",
    period: target.period,
    returnType: "GSTR-3B" as const,
    status: target.status,
    attempts: target.status === "pending" ? 0 : 1,
    safeSignals: [],
    safeMessage: `${target.period} ${target.status}`,
    updatedAt: now,
    ...(target.status === "downloaded" ? { completedAt: now } : {}),
  }));

  return {
    schemaVersion: "1.0",
    ledgerId: "ledger-existing",
    status,
    scope: {
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    },
    currentTargetId: `GSTR-3B:2026-27:${currentPeriod}`,
    createdAt: now,
    updatedAt,
    targets: ledgerTargets,
  };
}

function mockLocalStorageGet(value: Record<string, unknown>): void {
  const localGet = browser.storage.local.get as unknown as {
    mockResolvedValue: (nextValue: Record<string, unknown>) => void;
  };
  localGet.mockResolvedValue(value);
}
