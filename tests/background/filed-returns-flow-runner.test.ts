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
  retryFiledReturnsTargetDownloadFlow,
  startFreshFiledReturnsDownloadFlow,
  type ActiveGstTab,
  type FiledReturnsFlowRunnerDeps,
} from "../../src/background/filed-returns-flow-runner";
import {
  observeBrowserDownloadById,
  observeNextBrowserDownload,
} from "../../src/background/download-observer";
import { suggestNextBrowserDownloadFilename } from "../../src/background/download-filename-suggester";
import { exportFullFiscalYearZip } from "../../src/background/filed-returns-full-fiscal-year-zip";
import { createPortalGstr2bWorkbook } from "../fixtures/gstr2b-workbook";
import { browser } from "wxt/browser";

type RuntimeMock = typeof browser.runtime & {
  getContexts: ReturnType<typeof vi.fn<() => Promise<unknown[]>>>;
};

vi.mock("wxt/browser", () => ({
  browser: {
    downloads: {
      download: vi.fn(async () => 81),
    },
    offscreen: {
      closeDocument: vi.fn(async () => undefined),
      createDocument: vi.fn(async () => undefined),
    },
    runtime: {
      getContexts: vi.fn(async () => []),
      getURL: vi.fn((path: string) => `chrome-extension://pack/${path}`),
      sendMessage: vi.fn(async (message: unknown) => {
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "PACK_OFFSCREEN_STAGE_FILED_RETURN" &&
          "payload" in message &&
          typeof message.payload === "object" &&
          message.payload !== null &&
          "requestId" in message.payload
        ) {
          return {
            ok: true,
            requestId: message.payload.requestId,
            staged: true,
            byteCountClass: "non-empty",
          };
        }
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP" &&
          "payload" in message &&
          typeof message.payload === "object" &&
          message.payload !== null &&
          "requestId" in message.payload
        ) {
          return {
            ok: true,
            requestId: message.payload.requestId,
            blobUrl: "blob:chrome-extension://pack/full-year.zip",
            zipEntryCount: 4,
          };
        }
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER" &&
          "payload" in message &&
          typeof message.payload === "object" &&
          message.payload !== null &&
          "requestId" in message.payload
        ) {
          return {
            ok: true,
            requestId: message.payload.requestId,
            cleared: true,
          };
        }
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "PACK_OFFSCREEN_CREATE_BLOB_URL" &&
          "payload" in message &&
          typeof message.payload === "object" &&
          message.payload !== null &&
          "requestId" in message.payload
        ) {
          return {
            ok: true,
            requestId: message.payload.requestId,
            blobUrl: "blob:chrome-extension://pack/captured-file",
          };
        }
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "PACK_OFFSCREEN_REVOKE_BLOB_URL" &&
          "payload" in message &&
          typeof message.payload === "object" &&
          message.payload !== null &&
          "requestId" in message.payload
        ) {
          return {
            ok: true,
            requestId: message.payload.requestId,
            revoked: true,
          };
        }
        return { ok: false, errorCategory: "invalid-message" };
      }),
    },
    scripting: {
      executeScript: vi.fn(async () => [
        {
          result: {
            actionId: "action-captured",
            dataUrl: `data:application/pdf;base64,${globalThis.btoa(
              "%PDF-1.7 synthetic\n%%EOF\n",
            )}`,
            safeSignals: ["portal-blob-captured", "native-blob-click-suppressed"],
          },
        },
      ]),
    },
    storage: {
      session: {
        get: vi.fn(async () => ({})),
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
      safeEvidence: {
        byteCountClass: "non-empty",
        downloadId: 81,
        mimeClass: "pdf",
        urlClass: "https",
      },
    }),
  ),
  observeNextBrowserDownload: vi.fn(() => ({
    promise: Promise.resolve({
      state: "completed",
      safeSignals: ["browser-download-completed"],
      safeMessage: "Completed.",
      safeEvidence: {
        byteCountClass: "non-empty",
        downloadId: 82,
        mimeClass: "pdf",
        urlClass: "blob",
      },
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
    const runtimeMock = browser.runtime as RuntimeMock;
    runtimeMock.getContexts.mockResolvedValue([]);
    vi.mocked(runtimeMock.getURL).mockImplementation(
      (path: string) => `chrome-extension://pack/${path}`,
    );
    vi.mocked(runtimeMock.sendMessage).mockImplementation(async (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "PACK_OFFSCREEN_STAGE_FILED_RETURN" &&
        "payload" in message &&
        typeof message.payload === "object" &&
        message.payload !== null &&
        "requestId" in message.payload
      ) {
        return {
          ok: true,
          requestId: message.payload.requestId,
          staged: true,
          byteCountClass: "non-empty",
        };
      }
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP" &&
        "payload" in message &&
        typeof message.payload === "object" &&
        message.payload !== null &&
        "requestId" in message.payload
      ) {
        return {
          ok: true,
          requestId: message.payload.requestId,
          blobUrl: "blob:chrome-extension://pack/full-year.zip",
          zipEntryCount: 4,
        };
      }
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "PACK_OFFSCREEN_CREATE_BLOB_URL" &&
        "payload" in message &&
        typeof message.payload === "object" &&
        message.payload !== null &&
        "requestId" in message.payload
      ) {
        return {
          ok: true,
          requestId: message.payload.requestId,
          blobUrl: "blob:chrome-extension://pack/captured-file",
        };
      }
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER" &&
        "payload" in message &&
        typeof message.payload === "object" &&
        message.payload !== null &&
        "requestId" in message.payload
      ) {
        return {
          ok: true,
          requestId: message.payload.requestId,
          cleared: true,
        };
      }
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "PACK_OFFSCREEN_REVOKE_BLOB_URL" &&
        "payload" in message &&
        typeof message.payload === "object" &&
        message.payload !== null &&
        "requestId" in message.payload
      ) {
        return {
          ok: true,
          requestId: message.payload.requestId,
          revoked: true,
        };
      }
      return { ok: false, errorCategory: "invalid-message" };
    });
    vi.mocked(browser.scripting.executeScript).mockImplementation(async (details) => [
      {
        result: {
          actionId: actionIdFromScriptingDetails(details),
          dataUrl: dataUrlForScriptingDetails(details),
          safeSignals: ["portal-blob-captured", "native-blob-click-suppressed"],
        },
      },
    ]);
    vi.mocked(observeNextBrowserDownload).mockReturnValue({
      promise: Promise.resolve({
        state: "completed",
        safeSignals: ["browser-download-completed", "browser-download-non-empty"],
        safeMessage: "Completed.",
        safeEvidence: {
          byteCountClass: "non-empty",
          downloadId: 82,
          mimeClass: "pdf",
          urlClass: "blob",
        },
      }),
      stop: vi.fn(),
    });
    mockLocalStorageGet({});
    mockSessionStorageGet({});
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
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
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
          artifactType: "PDF",
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

  it("runs a GSTR-1 full fiscal year with the selected PDF and Excel artifacts", async () => {
    const responses: PackMessageResponse[] = [
      filedGstr1DownloadReady("April", "PDF"),
      filedGstr1DownloadClicked("PDF"),
      filedGstr1DownloadReady("April", "EXCEL"),
      filedGstr1DownloadClicked("EXCEL"),
      filedGstr1DownloadReady("May", "PDF"),
      filedGstr1DownloadClicked("PDF"),
      filedGstr1DownloadReady("May", "EXCEL"),
      filedGstr1DownloadClicked("EXCEL"),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-1",
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
        scope: {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2026-27",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-1",
        },
        status: "complete",
        completedPeriods: ["April", "May"],
        totalPeriods: 2,
      },
    });

    const contentStepPayloads = sendMessageToTabWithInjection.mock.calls
      .filter(([, message]) => message.type === "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3")
      .map(([, message]) => message.payload);
    expect(contentStepPayloads).toEqual([
      expect.objectContaining({
        artifactType: "PDF_AND_EXCEL",
        period: "April",
        returnType: "GSTR-1",
      }),
      expect.objectContaining({
        artifactType: "EXCEL",
        period: "April",
        returnType: "GSTR-1",
      }),
      expect.objectContaining({
        artifactType: "PDF_AND_EXCEL",
        period: "May",
        returnType: "GSTR-1",
      }),
      expect.objectContaining({
        artifactType: "EXCEL",
        period: "May",
        returnType: "GSTR-1",
      }),
    ]);
    expect(contentStepPayloads.map((payload) => payload.period)).not.toContain(
      FULL_FISCAL_YEAR_PERIOD,
    );
    expect(
      sendMessageToTabWithInjection.mock.calls
        .filter(([, message]) => message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3")
        .map(([, message]) => message.payload),
    ).toEqual([
      expect.objectContaining({ artifactType: "PDF", period: "April", returnType: "GSTR-1" }),
      expect.objectContaining({ artifactType: "EXCEL", period: "April", returnType: "GSTR-1" }),
      expect.objectContaining({ artifactType: "PDF", period: "May", returnType: "GSTR-1" }),
      expect.objectContaining({ artifactType: "EXCEL", period: "May", returnType: "GSTR-1" }),
    ]);
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        scope: {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2026-27",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-1",
        },
        status: "complete",
        targets: [
          expect.objectContaining({
            artifactType: "PDF_AND_EXCEL",
            period: "April",
            returnType: "GSTR-1",
            status: "downloaded",
            targetId: "GSTR-1:2026-27:April:PDF_AND_EXCEL",
          }),
          expect.objectContaining({
            artifactType: "PDF_AND_EXCEL",
            period: "May",
            returnType: "GSTR-1",
            status: "downloaded",
            targetId: "GSTR-1:2026-27:May:PDF_AND_EXCEL",
          }),
        ],
      }),
    });
    expect(suggestNextBrowserDownloadFilename).toHaveBeenCalledWith(
      browser.downloads,
      expect.objectContaining({ expectedMimeTypes: ["application/pdf"] }),
      "complyeaze-pack/gst/2026-27/gstr-1/april.pdf",
    );
    expect(suggestNextBrowserDownloadFilename).toHaveBeenCalledWith(
      browser.downloads,
      expect.objectContaining({
        expectedFileExtensions: [".xlsx", ".xls"],
      }),
      "complyeaze-pack/gst/2026-27/gstr-1/april.xlsx",
    );
  });

  it("runs a GSTR-2B full fiscal year through captured PDF and Excel artifacts", async () => {
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
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
        } as PackMessageResponse;
      }

      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        const artifactType = message.payload.artifactType ?? "PDF";
        return {
          ok: true,
          mainWorldCaptureRequest: {
            actionId: message.payload.actionId,
            controlAttribute: "data-pack-gstr2b-capture-action",
            controlId: `control-${artifactType.toLowerCase()}`,
            maxBytes: 36 * 1024 * 1024,
            signalPrefix: "gstr2b",
          },
          downloadTrigger: {
            connectorId: "gst",
            scopeId: "gst-gstr2b-private-v0",
            state: "clicked",
            safeSignals: [
              "gstr2b-download-clicked",
              "gstr2b-portal-blob-download-captured",
              "gstr2b-extension-download-requested",
              `gstr2b-artifact-clicked:${artifactType}`,
            ],
            safeMessage: "Captured.",
          },
        } as PackMessageResponse;
      }

      return { ok: false, error: "Unexpected call." };
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-2B",
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
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-complete",
          "full-fiscal-year-opfs-cleared",
        ]),
      },
      flowSummary: {
        scope: {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2026-27",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-2B",
        },
        status: "complete",
        completedPeriods: ["April", "May"],
        totalPeriods: 2,
      },
    });

    const contentStepPayloads = sendMessageToTabWithInjection.mock.calls
      .filter(([, message]) => message.type === "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3")
      .map(([, message]) => message.payload);
    expect(contentStepPayloads).toEqual([
      expect.objectContaining({
        artifactType: "PDF_AND_EXCEL",
        period: "April",
        returnType: "GSTR-2B",
      }),
      expect.objectContaining({
        artifactType: "PDF_AND_EXCEL",
        period: "May",
        returnType: "GSTR-2B",
      }),
    ]);
    expect(contentStepPayloads.map((payload) => payload.period)).not.toContain(
      FULL_FISCAL_YEAR_PERIOD,
    );
    expect(browser.tabs.update).not.toHaveBeenCalledWith(
      17,
      expect.objectContaining({
        url: expect.stringContaining("returns/auth/dashboard"),
      }),
    );

    expect(
      sendMessageToTabWithInjection.mock.calls
        .filter(([, message]) => message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3")
        .map(([, message]) => message.payload),
    ).toEqual([
      expect.objectContaining({ artifactType: "PDF", period: "April", returnType: "GSTR-2B" }),
      expect.objectContaining({ artifactType: "EXCEL", period: "April", returnType: "GSTR-2B" }),
      expect.objectContaining({ artifactType: "PDF", period: "May", returnType: "GSTR-2B" }),
      expect.objectContaining({ artifactType: "EXCEL", period: "May", returnType: "GSTR-2B" }),
    ]);

    expect(browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        conflictAction: "uniquify",
        filename: "gstr-2b-2026-27-full-year.zip",
        saveAs: false,
        url: "blob:chrome-extension://pack/full-year.zip",
      }),
    );
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
        payload: expect.objectContaining({
          zipPath: "april.pdf",
        }),
      }),
    );
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
        payload: expect.objectContaining({
          zipPath: "april.xlsx",
        }),
      }),
    );
    expect(observeBrowserDownloadById).toHaveBeenCalledTimes(1);
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        scope: {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2026-27",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-2B",
        },
        status: "complete",
        targets: [
          expect.objectContaining({
            artifactType: "PDF_AND_EXCEL",
            period: "April",
            returnType: "GSTR-2B",
            status: "downloaded",
            targetId: "GSTR-2B:2026-27:April:PDF_AND_EXCEL",
          }),
          expect.objectContaining({
            artifactType: "PDF_AND_EXCEL",
            period: "May",
            returnType: "GSTR-2B",
            status: "downloaded",
            targetId: "GSTR-2B:2026-27:May:PDF_AND_EXCEL",
          }),
        ],
      }),
    });
  });

  it("retains staged full-year files when the final zip download is unconfirmed", async () => {
    const stagedLedger: FiledReturnsFullFiscalYearLedger = {
      ...createFullFiscalYearLedger({
        currentPeriod: "May",
        status: "blocked",
        targets: [
          { period: "April", status: "downloaded" },
          { period: "May", status: "downloaded" },
        ],
      }),
      targets: createFullFiscalYearLedger({
        targets: [
          { period: "April", status: "downloaded" },
          { period: "May", status: "downloaded" },
        ],
      }).targets.map((target) => ({
        ...target,
        safeSignals: ["full-fiscal-year-opfs-staged"],
      })),
    };
    mockLocalStorageGet({ "full-year-ledger": stagedLedger });
    vi.mocked(observeBrowserDownloadById).mockResolvedValueOnce({
      state: "not-observed",
      safeSignals: ["browser-download-not-observed"],
      safeMessage: "Download was not observed.",
      userAction: {
        type: "ALLOW_MULTIPLE_DOWNLOADS",
        message: "Allow downloads, then retry.",
        canResume: true,
      },
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection:
          vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>(),
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
        state: "download-unconfirmed",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-zip-download-started",
          "full-fiscal-year-zip-download-unconfirmed",
          "full-fiscal-year-opfs-retained",
        ]),
      },
      flowSummary: {
        status: "blocked",
        completedPeriods: ["April", "May"],
        totalPeriods: 2,
      },
    });
    expect(
      response.ok && "flowStep" in response ? response.flowStep.safeSignals : [],
    ).not.toContain("full-fiscal-year-opfs-cleared");
    expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
      }),
    );
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({ status: "blocked" }),
    });
  });

  it("blocks GSTR-2B ZIP export when completed targets were not staged", async () => {
    const now = "2026-06-24T00:00:00.000Z";
    const ledger: FiledReturnsFullFiscalYearLedger = {
      schemaVersion: "1.0",
      ledgerId: "gstr2b-ledger-without-staged-files",
      status: "blocked",
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-2B",
      },
      createdAt: now,
      updatedAt: now,
      targets: ["April", "May"].map((period) => ({
        targetId: `GSTR-2B:2026-27:${period}:PDF_AND_EXCEL`,
        financialYear: "2026-27",
        period: period as FiledReturnsMonth,
        returnType: "GSTR-2B",
        artifactType: "PDF_AND_EXCEL",
        status: "downloaded",
        attempts: 1,
        safeSignals: ["filed-gstr2b-download-clicked"],
        safeMessage: `${period} downloaded.`,
        completedAt: now,
        updatedAt: now,
      })),
    };

    const response = await exportFullFiscalYearZip(ledger, {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
      state: "downloaded",
      safeSignals: ["full-fiscal-year-complete"],
      safeMessage: "Complete.",
    });

    expect(response).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining([
        "full-fiscal-year-complete",
        "full-fiscal-year-zip-no-staged-artifacts",
        "full-fiscal-year-opfs-retained",
      ]),
      safeMessage:
        "Pack completed the period checks, but did not stage any files for the final fiscal-year zip.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        canResume: true,
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
  });

  it("exports a single-period GSTR-2B PDF and Excel selection as one zip", async () => {
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
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
        } as PackMessageResponse;
      }

      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        const artifactType = message.payload.artifactType ?? "PDF";
        return {
          ok: true,
          mainWorldCaptureRequest: {
            actionId: message.payload.actionId,
            controlAttribute: "data-pack-gstr2b-capture-action",
            controlId: `control-${artifactType.toLowerCase()}`,
            maxBytes: 36 * 1024 * 1024,
            signalPrefix: "gstr2b",
          },
          downloadTrigger: {
            connectorId: "gst",
            scopeId: "gst-gstr2b-private-v0",
            state: "clicked",
            safeSignals: [
              "gstr2b-download-clicked",
              "gstr2b-portal-blob-download-captured",
              "gstr2b-extension-download-requested",
              `gstr2b-artifact-clicked:${artifactType}`,
            ],
            safeMessage: "Captured.",
          },
        } as PackMessageResponse;
      }

      return { ok: false, error: "Unexpected call." };
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
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
        safeSignals: expect.arrayContaining([
          "filed-return-artifact-downloaded:PDF",
          "filed-return-artifact-downloaded:EXCEL",
          "single-period-opfs-cleared",
          "single-period-zip-downloaded",
        ]),
      },
      flowSummary: {
        completedPeriods: ["May"],
        status: "complete",
        totalPeriods: 1,
      },
    });
    expect(browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        conflictAction: "uniquify",
        filename: "gstr-2b-2026-27-may.zip",
        saveAs: false,
        url: "blob:chrome-extension://pack/full-year.zip",
      }),
    );
    expect(observeBrowserDownloadById).toHaveBeenCalledWith(
      browser.downloads,
      81,
      expect.objectContaining({
        expectedFileExtensions: [".zip"],
        trustedDownloadIds: new Set([81]),
      }),
      45 * 1000,
    );
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
        payload: expect.objectContaining({
          zipPath: "may.pdf",
        }),
      }),
    );
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
        payload: expect.objectContaining({
          zipPath: "may.xlsx",
        }),
      }),
    );
    expect(observeBrowserDownloadById).toHaveBeenCalledTimes(1);
  });

  it("continues a GSTR-1 full fiscal year when a PDF is downloaded but Excel is unavailable", async () => {
    const responses: PackMessageResponse[] = [
      filedGstr1DownloadReady("April", "PDF"),
      filedGstr1DownloadClicked("PDF"),
      filedGstr1DownloadReady("April", "EXCEL"),
      filedGstr1ExcelNoDetailsAvailable(),
      filedGstr1DownloadReady("May", "PDF"),
      filedGstr1DownloadClicked("PDF"),
      filedGstr1DownloadReady("May", "EXCEL"),
      filedGstr1DownloadClicked("EXCEL"),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-1",
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
        scope: {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2026-27",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-1",
        },
        status: "complete",
        completedPeriods: ["April", "May"],
        totalPeriods: 2,
      },
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        status: "complete",
        targets: [
          expect.objectContaining({
            period: "April",
            safeSignals: expect.arrayContaining([
              "filed-return-artifact-downloaded:PDF",
              "filed-return-artifact-unavailable:EXCEL",
              "filed-gstr1-excel-no-details-available",
            ]),
            status: "downloaded",
          }),
          expect.objectContaining({
            period: "May",
            status: "downloaded",
          }),
        ],
      }),
    });
  });

  it("retries only the missing Excel artifact for a full-year GSTR-1 target with a completed PDF", async () => {
    const ledger: FiledReturnsFullFiscalYearLedger = {
      schemaVersion: "1.0",
      ledgerId: "ledger-existing",
      revision: 1,
      status: "blocked",
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-1",
      },
      currentTargetId: "GSTR-1:2026-27:April:PDF_AND_EXCEL",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      targets: [
        {
          artifactType: "PDF_AND_EXCEL",
          targetId: "GSTR-1:2026-27:April:PDF_AND_EXCEL",
          financialYear: "2026-27",
          period: "April",
          returnType: "GSTR-1",
          status: "download-unconfirmed",
          attempts: 1,
          safeSignals: [
            "filed-return-artifact-downloaded:PDF",
            "filed-return-artifact-unconfirmed:EXCEL",
            "browser-download-correlation-rejected",
          ],
          safeMessage: "Excel needs review.",
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
        {
          artifactType: "PDF_AND_EXCEL",
          targetId: "GSTR-1:2026-27:May:PDF_AND_EXCEL",
          financialYear: "2026-27",
          period: "May",
          returnType: "GSTR-1",
          status: "downloaded",
          attempts: 1,
          safeSignals: [
            "filed-return-artifact-downloaded:PDF",
            "filed-return-artifact-downloaded:EXCEL",
          ],
          safeMessage: "May complete.",
          completedAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
      ],
    };
    const localStorageState: Record<string, unknown> = { "full-year-ledger": ledger };
    mockLocalStorageGet(localStorageState);
    vi.mocked(browser.storage.local.set).mockImplementation(async (value) => {
      Object.assign(localStorageState, value);
    });
    const responses: PackMessageResponse[] = [
      filedGstr1DownloadReady("April", "EXCEL"),
      filedGstr1DownloadClicked("EXCEL"),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await retryFullFiscalYearTargetDownloadFlow(
      {
        ledgerId: "ledger-existing",
        targetId: "GSTR-1:2026-27:April:PDF_AND_EXCEL",
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
      flowSummary: {
        status: "complete",
        completedPeriods: ["April", "May"],
      },
    });
    expect(
      sendMessageToTabWithInjection.mock.calls
        .filter(([, message]) => message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3")
        .map(([, message]) => message.payload.artifactType),
    ).toEqual(["EXCEL"]);
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        status: "complete",
        targets: expect.arrayContaining([
          expect.objectContaining({
            artifactType: "PDF_AND_EXCEL",
            period: "April",
            safeSignals: expect.arrayContaining([
              "filed-return-artifact-downloaded:PDF",
              "filed-return-artifact-downloaded:EXCEL",
            ]),
            status: "downloaded",
          }),
        ]),
      }),
    });
  });

  it("uses the direct GST PDF endpoint before clicking the portal download control", async () => {
    const directUrl = "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=052026";
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      {
        ok: true,
        directDownloadRequest: {
          actionId: "action-direct",
          safeSignals: [
            "filed-gstr3b-direct-download-path-built",
            "filed-gstr3b-direct-download-probe-accepted",
          ],
          url: directUrl,
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        "directDownloadRequest" in response &&
        message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3"
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
        downloadDiagnostic: {
          schemaVersion: "1.0",
          eventType: "filed-return-download-path",
          actionId: expect.any(String),
          artifactType: "PDF",
          byteCountClass: "non-empty",
          downloadId: 81,
          downloadPathClass: "extension-direct-https",
          endpointClass: "gstr3b-getgenpdf",
          financialYear: "2026-27",
          mimeClass: "pdf",
          period: "May",
          returnType: "GSTR-3B",
          status: "downloaded",
        },
      },
    });
    expect(browser.downloads.download).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf",
      saveAs: false,
      url: directUrl,
    });
    const directObservationContext = vi.mocked(observeBrowserDownloadById).mock.calls.at(-1)?.[2];
    expect(directObservationContext?.trustedDownloadIds?.has(81)).toBe(true);
    expect(directObservationContext?.expectedUrlSubstrings).toEqual([
      "/returns/auth/api/gstr3b/getgenpdf",
      "rtn_prd=052026",
    ]);
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3",
    ]);
  });

  it("falls back to one target-bound GSTR-3B portal click when main-world capture fails", async () => {
    vi.mocked(browser.scripting.executeScript).mockResolvedValueOnce([
      {
        result: {
          capturedDownloadRequest: null,
          safeFailureSignals: ["filed-gstr3b-main-world-capture-timeout"],
        },
      },
    ] as never);
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      {
        ok: true,
        mainWorldCaptureRequest: {
          actionId: "action-captured",
          controlAttribute: "data-pack-gstr2b-capture-action",
          controlId: "control-gstr3b-pdf",
          maxBytes: 36 * 1024 * 1024,
          signalPrefix: "filed-gstr3b",
        },
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-download-clicked", "filed-gstr3b-download-clicked"],
          safeMessage: "Capture armed.",
        },
      },
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-download-clicked", "filed-gstr3b-download-clicked"],
          safeMessage: "Portal download clicked.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
        "mainWorldCaptureRequest" in response
      ) {
        response.mainWorldCaptureRequest.actionId = message.payload.actionId;
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
        safeSignals: expect.arrayContaining(["filed-gstr3b-capture-fallback-portal-click"]),
      },
    });
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
    expect(sendMessageToTabWithInjection.mock.calls.at(-1)?.[1].payload).toMatchObject({
      forcePortalClick: true,
    });
    expect(vi.mocked(observeNextBrowserDownload).mock.calls.at(-1)?.[1]).toMatchObject({
      allowTargetBoundBlobOrData: true,
    });
    expect(vi.mocked(observeNextBrowserDownload).mock.calls.at(-1)?.[2]).toBe(120_000);
  });

  it("saves captured May GSTR-3B portal PDF blobs through the extension downloads API after direct fallback", async () => {
    vi.mocked(observeBrowserDownloadById).mockResolvedValueOnce({
      state: "completed",
      safeSignals: ["browser-download-completed", "browser-download-non-empty"],
      safeMessage: "Completed.",
      safeEvidence: {
        byteCountClass: "non-empty",
        downloadId: 81,
        mimeClass: "pdf",
        urlClass: "blob",
      },
    });
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "blocked",
          safeSignals: ["filed-gstr3b-direct-download-fetch-unavailable"],
          safeMessage: "Direct endpoint unavailable.",
        },
      },
      {
        ok: true,
        mainWorldCaptureRequest: {
          actionId: "action-captured",
          controlAttribute: "data-pack-gstr2b-capture-action",
          controlId: "control-gstr3b-pdf",
          maxBytes: 36 * 1024 * 1024,
          signalPrefix: "filed-gstr3b",
        },
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: [
            "filed-return-download-clicked",
            "filed-gstr3b-download-clicked",
            "filed-gstr3b-portal-blob-download-captured",
            "filed-gstr3b-extension-download-requested",
          ],
          safeMessage: "Captured.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
        "mainWorldCaptureRequest" in response
      ) {
        response.mainWorldCaptureRequest.actionId = message.payload.actionId;
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
          "filed-gstr3b-extension-download-started",
          "browser-download-completed",
          "filed-return-artifact-downloaded:PDF",
        ]),
        downloadDiagnostic: {
          artifactType: "PDF",
          byteCountClass: "non-empty",
          downloadId: 81,
          downloadPathClass: "captured-portal-request-blob",
          endpointClass: "gstr3b-portal-blob-captured-download",
          financialYear: "2026-27",
          mimeClass: "pdf",
          period: "May",
          returnType: "GSTR-3B",
          status: "downloaded",
        },
      },
    });
    expect(browser.downloads.download).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf",
      saveAs: false,
      url: "blob:chrome-extension://pack/captured-file",
    });
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
  });

  it("uses portal click observation instead of the GSTR-3B direct endpoint for GSTR-1", async () => {
    const responses: PackMessageResponse[] = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "ready",
          safeSignals: [
            "filed-return-download-ready",
            "filed-gstr1-download-ready",
            "filed-return-detail-period:March",
          ],
          safeMessage: "Ready.",
        },
      },
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-download-clicked", "filed-gstr1-download-clicked"],
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
        returnType: "GSTR-1",
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
          "filed-gstr1-download-clicked",
          "browser-download-completed",
        ]),
        downloadDiagnostic: {
          schemaVersion: "1.0",
          eventType: "filed-return-download-path",
          actionId: expect.any(String),
          artifactType: "PDF",
          byteCountClass: "non-empty",
          downloadId: 82,
          downloadPathClass: "portal-click-blob",
          endpointClass: "gstr1-pdf-portal-rendered-download",
          financialYear: "2025-26",
          mimeClass: "pdf",
          period: "March",
          returnType: "GSTR-1",
          status: "downloaded",
        },
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
    expect(suggestNextBrowserDownloadFilename).toHaveBeenCalledWith(
      browser.downloads,
      expect.objectContaining({
        expectedMimeTypes: ["application/pdf"],
        expectedOrigins: expect.arrayContaining(["https://return.gst.gov.in"]),
      }),
      "complyeaze-pack/gst/2025-26/gstr-1/march.pdf",
    );
  });

  it("saves captured GSTR-1 summary PDF files through the extension downloads API", async () => {
    vi.mocked(observeBrowserDownloadById).mockResolvedValueOnce({
      state: "completed",
      safeSignals: ["browser-download-completed", "browser-download-non-empty"],
      safeMessage: "Completed.",
      safeEvidence: {
        byteCountClass: "non-empty",
        downloadId: 81,
        mimeClass: "pdf",
        urlClass: "blob",
      },
    });
    const responses: PackMessageResponse[] = [
      filedGstr1DownloadReady("March", "PDF"),
      {
        ok: true,
        mainWorldCaptureRequest: {
          actionId: "action-captured",
          controlAttribute: "data-pack-gstr2b-capture-action",
          controlId: "control-pdf",
          maxBytes: 36 * 1024 * 1024,
          signalPrefix: "filed-gstr1",
        },
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: [
            "filed-return-download-clicked",
            "filed-gstr1-download-clicked",
            "filed-gstr1-portal-blob-download-captured",
            "filed-gstr1-extension-download-requested",
          ],
          safeMessage: "Captured.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
        "mainWorldCaptureRequest" in response
      ) {
        response.mainWorldCaptureRequest.actionId = message.payload.actionId;
      }
      return response;
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-1",
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
          "filed-gstr1-extension-download-started",
          "browser-download-completed",
          "filed-return-artifact-downloaded:PDF",
        ]),
        downloadDiagnostic: {
          schemaVersion: "1.0",
          eventType: "filed-return-download-path",
          actionId: expect.any(String),
          artifactType: "PDF",
          byteCountClass: "non-empty",
          downloadId: 81,
          downloadPathClass: "captured-portal-request-blob",
          endpointClass: "gstr1-pdf-portal-blob-captured-download",
          financialYear: "2025-26",
          mimeClass: "pdf",
          period: "March",
          returnType: "GSTR-1",
          status: "downloaded",
        },
      },
    });
    expect(browser.downloads.download).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "complyeaze-pack/gst/2025-26/gstr-1/march.pdf",
      saveAs: false,
      url: "blob:chrome-extension://pack/captured-file",
    });
    expect(browser.offscreen.createDocument).toHaveBeenCalledWith({
      justification:
        "Create and revoke a temporary Blob URL for an explicit local GST return download.",
      reasons: ["BLOBS"],
      url: "offscreen.html",
    });
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_CREATE_BLOB_URL",
        target: "pack-offscreen-blob-url",
      }),
    );
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_REVOKE_BLOB_URL",
        target: "pack-offscreen-blob-url",
      }),
    );
    expect(browser.offscreen.closeDocument).toHaveBeenCalled();
    expect(vi.mocked(observeBrowserDownloadById)).toHaveBeenCalledWith(
      browser.downloads,
      81,
      expect.objectContaining({
        expectedMimeTypes: ["application/pdf"],
        expectedOrigins: expect.arrayContaining(["https://return.gst.gov.in"]),
      }),
    );
  });

  it("saves captured GSTR-1 e-invoice Excel files through the extension downloads API", async () => {
    vi.mocked(observeBrowserDownloadById).mockResolvedValueOnce({
      state: "completed",
      safeSignals: ["browser-download-completed", "browser-download-non-empty"],
      safeMessage: "Completed.",
      safeEvidence: {
        byteCountClass: "non-empty",
        downloadId: 81,
        mimeClass: "spreadsheet",
        urlClass: "blob",
      },
    });
    const responses: PackMessageResponse[] = [
      filedGstr1DownloadReady("March", "EXCEL"),
      {
        ok: true,
        mainWorldCaptureRequest: {
          actionId: "action-captured",
          controlAttribute: "data-pack-gstr2b-capture-action",
          controlId: "control-excel",
          maxBytes: 36 * 1024 * 1024,
          signalPrefix: "filed-gstr1",
        },
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: [
            "filed-return-download-clicked",
            "filed-gstr1-download-clicked",
            "text-download-excel-gstr1",
            "filed-gstr1-portal-blob-download-captured",
            "filed-gstr1-extension-download-requested",
          ],
          safeMessage: "Captured.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
        "mainWorldCaptureRequest" in response
      ) {
        response.mainWorldCaptureRequest.actionId = message.payload.actionId;
      }
      return response;
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "EXCEL",
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-1",
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
          "filed-gstr1-extension-download-started",
          "browser-download-completed",
          "filed-return-artifact-downloaded:EXCEL",
        ]),
        downloadDiagnostic: {
          artifactType: "EXCEL",
          byteCountClass: "non-empty",
          downloadId: 81,
          downloadPathClass: "captured-portal-request-blob",
          endpointClass: "gstr1-excel-portal-blob-captured-download",
          financialYear: "2025-26",
          mimeClass: "spreadsheet",
          period: "March",
          returnType: "GSTR-1",
          status: "downloaded",
        },
      },
    });
    expect(browser.downloads.download).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "complyeaze-pack/gst/2025-26/gstr-1/march.xlsx",
      saveAs: false,
      url: "blob:chrome-extension://pack/captured-file",
    });
  });

  it("saves captured GSTR-2B files through the extension downloads API", async () => {
    vi.mocked(observeBrowserDownloadById).mockResolvedValueOnce({
      state: "completed",
      safeSignals: ["browser-download-completed", "browser-download-non-empty"],
      safeMessage: "Completed.",
      safeEvidence: {
        byteCountClass: "non-empty",
        downloadId: 81,
        mimeClass: "pdf",
        urlClass: "blob",
      },
    });
    const responses: PackMessageResponse[] = [
      {
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
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        return {
          ok: true,
          mainWorldCaptureRequest: {
            actionId: message.payload.actionId,
            controlAttribute: "data-pack-gstr2b-capture-action",
            controlId: "control-pdf",
            maxBytes: 36 * 1024 * 1024,
            signalPrefix: "gstr2b",
          },
          downloadTrigger: {
            connectorId: "gst",
            scopeId: "gst-gstr2b-private-v0",
            state: "clicked",
            safeSignals: [
              "gstr2b-download-clicked",
              "gstr2b-portal-blob-download-captured",
              "gstr2b-extension-download-requested",
            ],
            safeMessage: "Captured.",
          },
        } as PackMessageResponse;
      }
      return responses.shift() ?? { ok: false, error: "Unexpected call." };
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
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
          "gstr2b-extension-download-started",
          "browser-download-completed",
          "filed-return-artifact-downloaded:PDF",
        ]),
        downloadDiagnostic: {
          schemaVersion: "1.0",
          eventType: "filed-return-download-path",
          actionId: expect.any(String),
          returnType: "GSTR-2B",
          financialYear: "2026-27",
          period: "May",
          endpointClass: "gstr2b-portal-blob-captured-download",
          artifactType: "PDF",
          downloadPathClass: "captured-portal-request-blob",
          downloadId: 81,
          status: "downloaded",
          mimeClass: "pdf",
          byteCountClass: "non-empty",
        },
      },
    });
    expect(browser.downloads.download).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "complyeaze-pack/gst/2026-27/gstr-2b/may.pdf",
      saveAs: false,
      url: "blob:chrome-extension://pack/captured-file",
    });
    expect(vi.mocked(observeBrowserDownloadById)).toHaveBeenCalledWith(
      browser.downloads,
      81,
      expect.objectContaining({
        expectedMimeTypes: ["application/pdf"],
        expectedOrigins: ["https://gstr2b.gst.gov.in"],
      }),
    );
    const observationContext = vi.mocked(observeBrowserDownloadById).mock.calls.at(-1)?.[2];
    expect(observationContext?.trustedDownloadIds?.has(81)).toBe(true);
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
  });

  it("rejects captured GSTR-2B payloads that do not match the requested artifact", async () => {
    vi.mocked(browser.scripting.executeScript).mockImplementationOnce(async (details) => [
      {
        result: {
          actionId: actionIdFromScriptingDetails(details),
          dataUrl: dataUrl("text/plain", "not a pdf"),
          safeSignals: ["gstr2b-portal-blob-captured"],
        },
      },
    ]);
    const responses: PackMessageResponse[] = [
      {
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
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        return {
          ok: true,
          mainWorldCaptureRequest: {
            actionId: message.payload.actionId,
            controlAttribute: "data-pack-gstr2b-capture-action",
            controlId: "control-pdf",
            maxBytes: 36 * 1024 * 1024,
            signalPrefix: "gstr2b",
          },
          downloadTrigger: {
            connectorId: "gst",
            scopeId: "gst-gstr2b-private-v0",
            state: "clicked",
            safeSignals: ["gstr2b-download-clicked"],
            safeMessage: "Captured.",
          },
        } as PackMessageResponse;
      }
      return responses.shift() ?? { ok: false, error: "Unexpected call." };
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
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
        safeSignals: ["gstr2b-captured-download-data-url-rejected"],
        downloadDiagnostic: {
          schemaVersion: "1.0",
          eventType: "filed-return-download-path",
          actionId: expect.any(String),
          returnType: "GSTR-2B",
          financialYear: "2026-27",
          period: "May",
          endpointClass: "gstr2b-portal-blob-captured-download",
          artifactType: "PDF",
          downloadPathClass: "captured-portal-request-unknown",
          status: "blocked",
          errorCategory: "gstr2b-captured-download-data-url-rejected",
        },
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(observeBrowserDownloadById).not.toHaveBeenCalled();
  });

  it("blocks when Brave rejects the extension-owned GSTR-2B captured download", async () => {
    vi.mocked(browser.downloads.download).mockRejectedValueOnce(new Error("save rejected"));
    const responses: PackMessageResponse[] = [
      {
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
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        return {
          ok: true,
          mainWorldCaptureRequest: {
            actionId: message.payload.actionId,
            controlAttribute: "data-pack-gstr2b-capture-action",
            controlId: "control-pdf",
            maxBytes: 36 * 1024 * 1024,
            signalPrefix: "gstr2b",
          },
          downloadTrigger: {
            connectorId: "gst",
            scopeId: "gst-gstr2b-private-v0",
            state: "clicked",
            safeSignals: [
              "gstr2b-download-clicked",
              "gstr2b-portal-blob-download-captured",
              "gstr2b-extension-download-requested",
            ],
            safeMessage: "Captured.",
          },
        } as PackMessageResponse;
      }
      return responses.shift() ?? { ok: false, error: "Unexpected call." };
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
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
        safeSignals: expect.arrayContaining(["gstr2b-extension-download-start-rejected"]),
        downloadDiagnostic: {
          schemaVersion: "1.0",
          eventType: "filed-return-download-path",
          actionId: expect.any(String),
          returnType: "GSTR-2B",
          financialYear: "2026-27",
          period: "May",
          endpointClass: "gstr2b-portal-blob-captured-download",
          artifactType: "PDF",
          downloadPathClass: "captured-portal-request-unknown",
          status: "blocked",
          errorCategory: "gstr2b-extension-download-start-rejected",
        },
        userAction: {
          type: "ALLOW_MULTIPLE_DOWNLOADS",
          canResume: true,
        },
      },
    });
    expect(observeBrowserDownloadById).not.toHaveBeenCalled();
  });

  it("stops GSTR-2B when portal blob capture cannot stay dialog-free", async () => {
    vi.mocked(browser.scripting.executeScript).mockImplementationOnce(async () => [
      { result: null },
    ]);
    const responses: PackMessageResponse[] = [
      {
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
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        return {
          ok: true,
          mainWorldCaptureRequest: {
            actionId: message.payload.actionId,
            controlAttribute: "data-pack-gstr2b-capture-action",
            controlId: "control-pdf",
            maxBytes: 36 * 1024 * 1024,
            signalPrefix: "gstr2b",
          },
          downloadTrigger: {
            connectorId: "gst",
            scopeId: "gst-gstr2b-private-v0",
            state: "clicked",
            safeSignals: [
              "gstr2b-download-clicked",
              "gstr2b-portal-blob-download-captured",
              "gstr2b-extension-download-requested",
            ],
            safeMessage: "Captured.",
          },
        } as PackMessageResponse;
      }
      return responses.shift() ?? { ok: false, error: "Unexpected call." };
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
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
        state: "unsupported-page",
        safeSignals: expect.arrayContaining([
          "gstr2b-dialog-free-capture-unsupported",
          "gstr2b-blob-capture-failed",
          "gstr2b-main-world-capture-result-rejected",
        ]),
        downloadDiagnostic: {
          returnType: "GSTR-2B",
          period: "May",
          artifactType: "PDF",
          downloadPathClass: "captured-portal-request-unknown",
          status: "unsupported-page",
          errorCategory: "gstr2b-blob-capture-failed",
        },
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          canResume: false,
        },
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(observeBrowserDownloadById).not.toHaveBeenCalled();
  });

  it("explains that Brave's save dialog can block GSTR-2B portal blob downloads", async () => {
    vi.mocked(observeNextBrowserDownload).mockReturnValueOnce({
      promise: Promise.resolve({
        state: "not-observed",
        safeSignals: ["browser-download-not-observed"],
        safeMessage: "No browser download observed.",
        userAction: {
          type: "ALLOW_MULTIPLE_DOWNLOADS",
          message:
            "Allow browser downloads for the GST Portal, then start the Pack download again.",
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
          scopeId: "gst-gstr2b-private-v0",
          state: "ready",
          safeSignals: [
            "gstr2b-summary-route",
            "gstr2b-download-ready",
            "filed-return-download-ready",
          ],
          safeMessage: "Ready.",
        },
      },
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-gstr2b-private-v0",
          state: "clicked",
          safeSignals: ["gstr2b-download-clicked", "gstr2b-portal-blob-download-clicked"],
          safeMessage: "Clicked download.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "EXCEL",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
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
        state: "download-unconfirmed",
        safeSignals: expect.arrayContaining([
          "gstr2b-portal-blob-download-clicked",
          "browser-download-not-observed",
          "browser-download-save-dialog-may-be-open",
          "filed-return-artifact-unconfirmed:EXCEL",
        ]),
        safeMessage: expect.stringContaining("ask-where-to-save dialog"),
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
  });

  it("continues from the filed GSTR-1 View Summary navigation step before triggering the PDF", async () => {
    const responses: PackMessageResponse[] = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-gstr1-summary-view-clicked"],
          safeMessage: "Opened summary.",
        },
      },
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "ready",
          safeSignals: [
            "filed-return-download-ready",
            "filed-gstr1-download-ready",
            "download-pdf-gstr-1",
            "filed-return-detail-period:May",
          ],
          safeMessage: "Summary PDF ready.",
        },
      },
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-download-clicked", "filed-gstr1-download-clicked"],
          safeMessage: "Clicked PDF download.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-1",
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
          "filed-gstr1-download-clicked",
          "browser-download-completed",
        ]),
      },
    });
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
    expect(
      sendMessageToTabWithInjection.mock.calls
        .filter(([, message]) => message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3")
        .map(([, message]) => message.payload.artifactType),
    ).toEqual(["PDF"]);
  });

  it("waits for the filed GSTR-1 detail step after opening a result row before triggering the PDF", async () => {
    const responses: PackMessageResponse[] = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-result-view-clicked", "filed-return-result-period:May"],
          safeMessage: "Opened row.",
        },
      },
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-gstr1-summary-view-clicked"],
          safeMessage: "Opened summary.",
        },
      },
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "ready",
          safeSignals: [
            "filed-return-download-ready",
            "filed-gstr1-download-ready",
            "download-pdf-gstr-1",
            "filed-return-detail-period:May",
          ],
          safeMessage: "Summary PDF ready.",
        },
      },
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-download-clicked", "filed-gstr1-download-clicked"],
          safeMessage: "Clicked PDF download.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-1",
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
          "filed-gstr1-download-clicked",
          "browser-download-completed",
        ]),
      },
    });
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
  });

  it("downloads GSTR-1 summary PDF and e-invoice details Excel through portal clicks when requested", async () => {
    const responses: PackMessageResponse[] = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-gstr1-summary-view-clicked"],
          safeMessage: "Opened summary.",
        },
      },
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "ready",
          safeSignals: [
            "filed-return-download-ready",
            "filed-gstr1-download-ready",
            "download-pdf-gstr-1",
            "filed-return-detail-period:May",
          ],
          safeMessage: "Summary PDF ready.",
        },
      },
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-download-clicked", "filed-gstr1-download-clicked"],
          safeMessage: "Clicked PDF download.",
        },
      },
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-gstr1-summary-back-clicked"],
          safeMessage: "Returned to detail.",
        },
      },
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "ready",
          safeSignals: [
            "filed-return-download-ready",
            "filed-gstr1-download-ready",
            "download-excel-gstr-1",
            "filed-return-detail-period:May",
          ],
          safeMessage: "Excel ready.",
        },
      },
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: [
            "filed-return-download-clicked",
            "filed-gstr1-download-clicked",
            "text-download-excel-gstr1",
          ],
          safeMessage: "Clicked e-invoice details Excel download.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-1",
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
          "filed-return-artifact-downloaded:PDF",
          "filed-return-artifact-downloaded:EXCEL",
          "text-download-excel-gstr1",
        ]),
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
    expect(
      sendMessageToTabWithInjection.mock.calls
        .filter(([, message]) => message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3")
        .map(([, message]) => message.payload.artifactType),
    ).toEqual(["PDF", "EXCEL"]);
    expect(suggestNextBrowserDownloadFilename).toHaveBeenCalledWith(
      browser.downloads,
      expect.objectContaining({
        expectedMimeTypes: ["application/pdf"],
        expectedOrigins: expect.arrayContaining(["https://return.gst.gov.in"]),
      }),
      "complyeaze-pack/gst/2025-26/gstr-1/may.pdf",
    );
    expect(suggestNextBrowserDownloadFilename).toHaveBeenCalledWith(
      browser.downloads,
      expect.objectContaining({
        expectedFileExtensions: [".xlsx", ".xls"],
        expectedMimeTypes: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
        ],
      }),
      "complyeaze-pack/gst/2025-26/gstr-1/may.xlsx",
    );
  });

  it("reports GSTR-1 e-invoice details Excel completion with the Excel artifact label", async () => {
    const responses: PackMessageResponse[] = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-gstr1-summary-view-clicked"],
          safeMessage: "Opened summary.",
        },
      },
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "ready",
          safeSignals: [
            "filed-return-download-ready",
            "filed-gstr1-download-ready",
            "download-pdf-gstr-1",
            "filed-return-detail-period:May",
          ],
          safeMessage: "Summary PDF ready.",
        },
      },
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: [
            "filed-return-download-clicked",
            "filed-gstr1-download-clicked",
            "text-download-excel-gstr1",
          ],
          safeMessage: "Clicked e-invoice details Excel download.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "EXCEL",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-1",
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
        safeMessage:
          "The browser reported that the filed-return e-invoice details Excel download completed. Check the local downloads folder for the GST Portal file.",
        safeSignals: expect.arrayContaining([
          "filed-return-artifact-downloaded:EXCEL",
          "text-download-excel-gstr1",
        ]),
      },
    });
  });

  it("persists combined GSTR-1 PDF progress before attempting e-invoice details Excel", async () => {
    vi.mocked(observeNextBrowserDownload)
      .mockReturnValueOnce({
        promise: Promise.resolve({
          state: "completed",
          safeSignals: ["browser-download-completed", "browser-download-non-empty"],
          safeMessage: "PDF completed.",
        }),
        stop: vi.fn(),
      })
      .mockReturnValueOnce({
        promise: Promise.resolve({
          state: "not-observed",
          safeSignals: ["browser-download-not-observed"],
          safeMessage: "Excel not observed.",
          userAction: {
            type: "ALLOW_MULTIPLE_DOWNLOADS",
            message: "Allow downloads.",
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
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-gstr1-summary-view-clicked"],
          safeMessage: "Opened summary.",
        },
      },
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "ready",
          safeSignals: [
            "filed-return-download-ready",
            "filed-gstr1-download-ready",
            "download-pdf-gstr-1",
            "filed-return-detail-period:May",
          ],
          safeMessage: "Summary PDF ready.",
        },
      },
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-download-clicked", "filed-gstr1-download-clicked"],
          safeMessage: "Clicked PDF download.",
        },
      },
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-gstr1-summary-back-clicked"],
          safeMessage: "Returned to detail.",
        },
      },
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "ready",
          safeSignals: [
            "filed-return-download-ready",
            "filed-gstr1-download-ready",
            "download-excel-gstr-1",
            "filed-return-detail-period:May",
          ],
          safeMessage: "Excel ready.",
        },
      },
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "clicked",
          safeSignals: [
            "filed-return-download-clicked",
            "filed-gstr1-download-clicked",
            "text-download-excel-gstr1",
          ],
          safeMessage: "Clicked e-invoice details Excel download.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-1",
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
        safeMessage: expect.stringContaining("did not export a partial zip"),
        safeSignals: expect.arrayContaining([
          "browser-download-not-observed",
          "single-period-zip-incomplete",
          "single-period-opfs-cleared",
        ]),
      },
    });
    expect("flowStep" in response).toBe(true);
    if (!("flowStep" in response)) throw new Error("Expected a flow-step response.");
    expect(response.flowStep.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-artifact-unconfirmed:EXCEL"]),
    );
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "target-review": expect.objectContaining({
        targetId: "GSTR-1:2025-26:May:EXCEL",
        scope: {
          artifactType: "EXCEL",
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-1",
        },
      }),
    });
  });

  it("keeps Excel recovery copy when browser correlation rejects the observed download", async () => {
    vi.mocked(observeNextBrowserDownload)
      .mockReturnValueOnce({
        promise: Promise.resolve({
          state: "completed",
          safeSignals: ["browser-download-completed", "browser-download-non-empty"],
          safeMessage: "Completed.",
        }),
        stop: vi.fn(),
      })
      .mockReturnValueOnce({
        promise: Promise.resolve({
          state: "not-observed",
          safeSignals: ["browser-download-correlation-rejected"],
          safeMessage: "The observed download did not match the expected Excel file.",
          userAction: {
            type: "RETRY_PORTAL_GENERATION",
            message: "Retry.",
            canResume: true,
          },
        }),
        stop: vi.fn(),
      });
    const responses: PackMessageResponse[] = [
      filedGstr1DownloadReady("May", "PDF"),
      filedGstr1DownloadClicked("PDF"),
      filedGstr1DownloadReady("May", "EXCEL"),
      filedGstr1DownloadClicked("EXCEL"),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-1",
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
        safeMessage: expect.stringContaining("did not export a partial zip"),
        safeSignals: expect.arrayContaining([
          "browser-download-correlation-rejected",
          "filed-return-artifact-unconfirmed:EXCEL",
          "single-period-zip-incomplete",
          "single-period-opfs-cleared",
        ]),
      },
    });
  });

  it("reruns a pre-bundle partial combined GSTR-1 run so the final zip is complete", async () => {
    mockSessionStorageGet({
      completion: {
        scope: {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-1",
        },
        status: "partial",
        completedPeriods: [],
        currentPeriod: "May",
        totalPeriods: 1,
        updatedAt: "2026-07-02T10:00:00.000Z",
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "downloaded",
          safeSignals: ["filed-return-artifact-downloaded:PDF"],
          safeMessage: "PDF completed.",
        },
      },
    });
    let downloadStepCount = 0;
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      if (message.type === "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3") {
        downloadStepCount += 1;
        return {
          ok: true,
          flowStep: {
            connectorId: "gst",
            scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
            state: "ready",
            safeSignals: [
              "filed-return-download-ready",
              "filed-gstr1-download-ready",
              ...(downloadStepCount > 1 ? ["download-excel-gstr-1"] : []),
              "filed-return-detail-period:May",
            ],
            safeMessage: downloadStepCount > 1 ? "Excel ready." : "Ready.",
          },
        } as PackMessageResponse;
      }

      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        const artifactType = message.payload.artifactType ?? "PDF";
        return {
          ok: true,
          mainWorldCaptureRequest: {
            actionId: message.payload.actionId,
            controlAttribute: "data-pack-gstr1-capture-action",
            controlId: `control-gstr1-${artifactType.toLowerCase()}`,
            maxBytes: 36 * 1024 * 1024,
            signalPrefix: "filed-gstr1",
          },
          downloadTrigger: {
            connectorId: "gst",
            scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
            state: "clicked",
            safeSignals: [
              "filed-return-download-clicked",
              "filed-gstr1-download-clicked",
              "filed-gstr1-portal-blob-download-captured",
              "filed-gstr1-extension-download-requested",
              `filed-return-artifact-clicked:${artifactType}`,
            ],
            safeMessage: "Captured.",
          },
        } as PackMessageResponse;
      }

      return { ok: false, error: "Unexpected call." };
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-1",
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
          "filed-return-artifact-downloaded:PDF",
          "filed-return-artifact-downloaded:EXCEL",
          "single-period-zip-downloaded",
        ]),
      },
    });
    expect(
      sendMessageToTabWithInjection.mock.calls
        .filter(([, message]) => message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3")
        .map(([, message]) => message.payload.artifactType),
    ).toEqual(["PDF", "EXCEL"]);
    expect(browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "gstr-1-2025-26-may.zip",
      }),
    );
  });

  it("blocks a combined GSTR-1 start when a child e-invoice details Excel review is unresolved", async () => {
    mockLocalStorageGet({
      "target-review": {
        schemaVersion: "1.0",
        targetId: "GSTR-1:2025-26:May:EXCEL",
        status: "download-unconfirmed",
        scope: {
          artifactType: "EXCEL",
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-1",
        },
        safeSignals: ["browser-download-not-observed"],
        safeMessage: "Pack could not confirm the e-invoice details Excel download.",
        updatedAt: "2026-07-02T10:00:00.000Z",
      },
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-1",
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
      flowSummary: {
        scope: {
          artifactType: "EXCEL",
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-1",
        },
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  });

  it("blocks a different period while an earlier target still needs review", async () => {
    mockLocalStorageGet({
      "target-review": {
        schemaVersion: "1.0",
        targetId: "GSTR-3B:2026-27:April",
        status: "download-unconfirmed",
        scope: {
          financialYear: "2026-27",
          period: "April",
          returnType: "GSTR-3B",
        },
        safeSignals: ["browser-download-not-observed"],
        safeMessage: "Pack could not confirm the April browser download.",
        updatedAt: "2026-07-12T10:00:00.000Z",
      },
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

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
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["filed-returns-target-review-required"],
      },
      flowSummary: {
        currentPeriod: "April",
        scope: {
          financialYear: "2026-27",
          period: "April",
          returnType: "GSTR-3B",
        },
        status: "blocked",
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
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

  it("explains when search does not reach a filed GSTR-1 result before the retry limit", async () => {
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => ({
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "clicked",
        safeSignals: ["filed-return-filters-selected", "search-clicked"],
        safeMessage: "Pack selected the filed-return filters and clicked Search.",
      },
    }));

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "June",
        returnType: "GSTR-1",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-07-03T00:00:00.000Z"),
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
        safeSignals: expect.arrayContaining([
          "filed-return-filters-selected",
          "flow-step-limit-reached",
        ]),
        safeMessage: expect.stringContaining("did not show a filed GSTR-1 row"),
        userAction: {
          type: "WAIT_FOR_PORTAL_AVAILABILITY",
          canResume: true,
        },
      },
      flowSummary: {
        currentPeriod: "June",
        status: "blocked",
        totalPeriods: 1,
        updatedAt: "2026-07-03T00:00:00.000Z",
        flowStep: {
          state: "user-action-required",
          safeSignals: expect.arrayContaining(["flow-step-limit-reached"]),
        },
      },
    });
    expect("flowStep" in response).toBe(true);
    if (!("flowStep" in response)) throw new Error("Expected a flow-step response.");
    expect(response.flowStep.safeMessage).not.toContain("clicked Search");
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(12);
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        currentPeriod: "June",
        status: "blocked",
        flowStep: expect.objectContaining({
          state: "user-action-required",
          safeSignals: expect.arrayContaining(["flow-step-limit-reached"]),
        }),
      }),
    });
  });

  it("allows GSTR-2B to continue beyond the default filed-return step limit", async () => {
    const responses: PackMessageResponse[] = [
      gstr2bDashboardWaiting(),
      gstr2bDashboardWaiting(),
      gstr2bDashboardWaiting(),
      gstr2bDashboardWaiting(),
      gstr2bDashboardWaiting(),
      gstr2bDashboardWaiting(),
      gstr2bDownloadReady("May"),
      gstr2bDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-2B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-07-03T00:00:00.000Z"),
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
      flowSummary: {
        currentPeriod: "May",
        status: "complete",
        completedPeriods: ["May"],
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(8);
  });

  it("waits for the GSTR-2B summary page after opening a dashboard result row", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnRowOpened("May"),
      gstr2bDashboardWaiting(),
      gstr2bDownloadReady("May"),
      gstr2bDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-2B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-07-03T00:00:00.000Z"),
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
        safeSignals: expect.arrayContaining(["filed-gstr2b-download-clicked"]),
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(4);
  });

  it("polls GSTR-2B detail readiness immediately after dashboard navigation", async () => {
    const responses: PackMessageResponse[] = [
      gstr2bDashboardViewClicked("May"),
      gstr2bDownloadReady("May"),
      gstr2bDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-2B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-07-03T00:00:00.000Z"),
        timings: {
          flowStepSettleMs: 0,
          resultRowNavigationSettleMs: 60_000,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining(["filed-gstr2b-download-clicked"]),
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(3);
  });

  it("starts a fresh detail wait after opening GSTR-2B from the return dashboard", async () => {
    const responses: PackMessageResponse[] = [
      gstr2bDashboardViewClicked("April"),
      ...Array.from({ length: 11 }, () => gstr2bDashboardWaiting()),
      gstr2bDownloadReady("April"),
      gstr2bDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF",
        financialYear: "2025-26",
        period: "April",
        returnType: "GSTR-2B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
        },
        now: () => new Date("2026-07-03T00:00:00.000Z"),
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
        safeSignals: expect.arrayContaining(["filed-gstr2b-download-clicked"]),
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(14);
  });

  it("explains when a direct download is waiting on the browser native Save prompt", async () => {
    const directUrl = "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=052026";
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
          safeSignals: ["filed-gstr3b-direct-download-probe-accepted"],
          url: directUrl,
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        "directDownloadRequest" in response &&
        message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3"
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
        expectedUrlSubstrings: ["/returns/auth/api/gstr3b/getgenpdf", "rtn_prd=052026"],
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
        downloadDiagnostic: {
          artifactType: "PDF",
          byteCountClass: "non-empty",
          downloadId: 82,
          downloadPathClass: "portal-click-after-direct-fallback-blob",
          endpointClass: "gstr3b-portal-rendered-download",
          financialYear: "2026-27",
          mimeClass: "pdf",
          period: "May",
          returnType: "GSTR-3B",
          status: "downloaded",
        },
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
    expect(observeNextBrowserDownload).toHaveBeenCalledWith(
      browser.downloads,
      expect.objectContaining({
        expectedUrlSubstrings: [],
      }),
    );
  });

  it("falls back to the portal click when the direct PDF response is not verified", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "blocked",
          safeSignals: [
            "filed-gstr3b-direct-download-fetched",
            "filed-gstr3b-direct-download-non-pdf-response",
          ],
          safeMessage: "The GST endpoint did not return a verified PDF.",
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
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
  });

  it("falls back to the portal click when the direct resolver message fails before any download side effect", async () => {
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      if (message.type === "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3") {
        return filedReturnDownloadReady("May");
      }
      if (message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3") {
        throw new Error("direct resolver timed out");
      }
      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        return filedReturnDownloadClicked();
      }
      return { ok: false, error: "Unexpected call." };
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
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
  });

  it("falls back to the portal click when Chrome rejects the direct download start", async () => {
    const directUrl = "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=052026";
    vi.mocked(browser.downloads.download).mockImplementationOnce(async () => {
      throw new Error("downloads api rejected");
    });
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      {
        ok: true,
        directDownloadRequest: {
          actionId: "action-direct",
          safeSignals: ["filed-gstr3b-direct-download-probe-accepted"],
          url: directUrl,
        },
      },
      filedReturnDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        "directDownloadRequest" in response &&
        message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3"
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
      },
    });
    expect(browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
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
        message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3"
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
        message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3"
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
        message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3"
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

  it("starts a fresh full fiscal year run after a zero-progress blocked ledger", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "blocked",
        currentPeriod: "April",
        targets: [
          { period: "April", status: "blocked" },
          { period: "May", status: "pending" },
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
      flowSummary: {
        status: "complete",
        completedPeriods: ["April", "May"],
      },
    });
    const sentPeriods = sendMessageToTabWithInjection.mock.calls.map(
      ([, message]) => message.payload.period,
    );
    expect(sentPeriods).toEqual(["April", "April", "May", "May"]);
  });

  it("keeps a blocked full fiscal year ledger when it already has downloaded periods", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "blocked",
        currentPeriod: "May",
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
        completedPeriods: ["April"],
        currentPeriod: "May",
        status: "blocked",
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

  it("persists current-year reconciliation before returning a blocked-target summary", async () => {
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
        safeSignals: expect.arrayContaining(["full-fiscal-year-run-needs-action"]),
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
      type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
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
      type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      payload: {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenLastCalledWith(17, {
      type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
      payload: expect.objectContaining({
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      }),
    });
  });

  it("preserves a GSTR-1 Excel portal no-details block after the click", async () => {
    const responses: PackMessageResponse[] = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "ready",
          safeSignals: [
            "filed-return-download-ready",
            "filed-gstr1-download-ready",
            "filed-return-detail-period:May",
          ],
          safeMessage: "Ready.",
        },
      },
      {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "blocked",
          safeSignals: [
            "filed-return-download-clicked",
            "filed-gstr1-download-clicked",
            "filed-gstr1-excel-no-details-available",
          ],
          safeMessage:
            "The GST Portal reported that no e-invoice details are available for this filed GSTR-1 period.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "EXCEL",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-1",
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
        state: "blocked",
        safeSignals: expect.arrayContaining(["filed-gstr1-excel-no-details-available"]),
      },
    });
    expect(
      response.ok && "flowStep" in response ? response.flowStep.safeSignals : [],
    ).not.toContain("browser-download-completed");
    expect(sendMessageToTabWithInjection).toHaveBeenLastCalledWith(17, {
      type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
      payload: expect.objectContaining({
        artifactType: "EXCEL",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-1",
      }),
    });
  });

  it("waits for visible GSTR-3B target identity before attempting direct download after API handoff", async () => {
    const directUrl = "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=032026";
    const responses: PackMessageResponse[] = [
      filedReturnApiResultPosted("March"),
      blankGstr3bDetailRoute(),
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "ready",
          safeSignals: [
            "gstr-3b-detail-route",
            "filed-gstr3b-download-ready",
            "filed-return-detail-period:March",
            "filed-return-detail-financial-year:2025-26",
          ],
          safeMessage: "Ready.",
        },
      },
      {
        ok: true,
        directDownloadRequest: {
          actionId: "action-direct",
          safeSignals: ["filed-gstr3b-direct-download-path-built"],
          url: directUrl,
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false, error: "Unexpected call." };
      if (
        "directDownloadRequest" in response &&
        message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3"
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
        ]),
      },
    });
    expect(browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: directUrl }),
    );
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3",
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
      type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      payload: {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenLastCalledWith(17, {
      type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
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
        safeSignals: ["gst-portal-tab-required"],
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
          safeSignals: ["gst-portal-tab-required"],
        }),
      }),
    });
    expect(browser.tabs.create).not.toHaveBeenCalled();
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

  it("uses the main-world filter fallback once before resuming the target-bound flow", async () => {
    const responses: PackMessageResponse[] = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "candidate-not-found",
          safeSignals: ["filed-return-filter-candidate-not-found"],
          safeMessage: "Filed-return filters are not ready.",
        },
      },
      filedReturnDownloadReady("May"),
      filedReturnDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });
    const selectFiltersInMainWorld = vi.fn<
      NonNullable<FiledReturnsFlowRunnerDeps["selectFiltersInMainWorld"]>
    >(async () => ({
      state: "searched",
      safeSignals: ["main-world-search-clicked"],
    }));

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        selectFiltersInMainWorld,
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

    expect(response).toMatchObject({ ok: true, flowStep: { state: "downloaded" } });
    expect(selectFiltersInMainWorld).toHaveBeenCalledTimes(1);
    expect(selectFiltersInMainWorld).toHaveBeenCalledWith(17, {
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    });
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
  });

  it("treats positive not-filed evidence as a reconciled single-period result", async () => {
    const responses: PackMessageResponse[] = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "candidate-not-found",
          safeSignals: ["filed-return-positively-not-filed"],
          safeMessage: "The GST portal shows no filed GSTR-3B for this period.",
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
        now: () => new Date("2026-06-24T00:00:00.000Z"),
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowSummary: {
        completedAt: "2026-06-24T00:00:00.000Z",
        completedPeriods: ["March"],
        currentPeriod: "March",
        status: "complete",
        totalPeriods: 1,
        flowStep: {
          safeSignals: ["filed-return-positively-not-filed"],
        },
      },
    });
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        completedPeriods: ["March"],
        status: "complete",
        flowStep: expect.objectContaining({
          safeSignals: ["filed-return-positively-not-filed"],
        }),
      }),
    });
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
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
    ]);
  });

  it("stops a full fiscal year run when the portal reports a system error", async () => {
    const responses: PackMessageResponse[] = [
      gstr2bDownloadReady("April"),
      gstr2bDownloadClicked(),
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-gstr2b-private-v0",
          state: "blocked",
          safeSignals: ["portal-system-error"],
          safeMessage:
            "The GST portal returned a system-error page. Return to an authenticated GST page and retry this period.",
          userAction: {
            type: "WAIT_FOR_PORTAL_AVAILABILITY",
            message: "Return to an authenticated GST page after the portal system error clears.",
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
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: "FULL_FISCAL_YEAR",
        returnType: "GSTR-2B",
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
        safeSignals: expect.arrayContaining(["portal-system-error"]),
      },
      flowSummary: {
        completedPeriods: [],
        currentPeriod: "April",
        status: "blocked",
        totalPeriods: 12,
        flowStep: {
          state: "blocked",
          safeSignals: expect.arrayContaining(["portal-system-error"]),
        },
      },
    });
    const completionWrites = vi.mocked(browser.storage.session.set).mock.calls;
    expect(completionWrites.at(-1)?.[0]).toEqual({
      completion: expect.objectContaining({
        completedPeriods: [],
        currentPeriod: "April",
        status: "blocked",
        flowStep: expect.objectContaining({
          safeSignals: expect.arrayContaining(["portal-system-error"]),
        }),
      }),
    });
  });
  it("keeps a single-period review intact when another run is active", async () => {
    mockLocalStorageGet({
      "active-run": {
        schemaVersion: "1.0",
        runId: "run-existing",
        revision: 1,
        scope: { financialYear: "2026-27", period: "May", returnType: "GSTR-3B" },
        status: "running",
        leaseUpdatedAt: "2026-06-24T00:00:00.000Z",
      },
      "target-review": {
        schemaVersion: "1.0",
        targetId: "GSTR-3B:2025-26:March",
        status: "download-unconfirmed",
        scope: { financialYear: "2025-26", period: "March", returnType: "GSTR-3B" },
        safeSignals: ["browser-download-size-unknown"],
        safeMessage: "Pack could not confirm the browser download.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });

    const response = await retryFiledReturnsTargetDownloadFlow(
      { financialYear: "2025-26", period: "March", returnType: "GSTR-3B" },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection: vi.fn(),
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
      flowStep: { safeSignals: ["filed-returns-run-active"] },
    });
    expect(browser.storage.local.remove).not.toHaveBeenCalledWith("target-review");
  });

  it("discards a reviewed target only after acquiring the lease, then starts the selected run", async () => {
    mockLocalStorageGet({
      "target-review": {
        schemaVersion: "1.0",
        targetId: "GSTR-3B:2025-26:March",
        status: "download-unconfirmed",
        scope: { financialYear: "2025-26", period: "March", returnType: "GSTR-3B" },
        safeSignals: ["browser-download-size-unknown"],
        safeMessage: "Pack could not confirm the browser download.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });
    const responses: PackMessageResponse[] = [
      filedReturnRowOpened("May"),
      filedReturnDownloadClicked(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFreshFiledReturnsDownloadFlow(
      {
        scope: { financialYear: "2025-26", period: "May", returnType: "GSTR-3B" },
        recovery: {
          kind: "target-review",
          scope: { financialYear: "2025-26", period: "March", returnType: "GSTR-3B" },
        },
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
        timings: { flowStepSettleMs: 0, resultRowNavigationSettleMs: 0 },
      },
    );

    expect(response).toMatchObject({ ok: true, flowSummary: { status: "complete" } });
    expect(browser.storage.local.remove).toHaveBeenCalledWith("target-review");
    expect(sendMessageToTabWithInjection).toHaveBeenCalled();
    expect(sendMessageToTabWithInjection.mock.calls[0]?.[1].payload.period).toBe("May");
  });

  it("rejects a stale fresh-start revision without discarding the saved full-year run", async () => {
    mockLocalStorageGet({
      "full-year-ledger": {
        ...createFullFiscalYearLedger({
          status: "blocked",
          currentPeriod: "April",
          targets: [{ period: "April", status: "blocked" }],
        }),
        revision: 2,
      },
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await startFreshFiledReturnsDownloadFlow(
      {
        scope: { financialYear: "2026-27", period: "May", returnType: "GSTR-3B" },
        recovery: {
          kind: "full-fiscal-year",
          ledgerId: "ledger-existing",
          targetId: "GSTR-3B:2026-27:April",
          expectedRevision: 1,
        },
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
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: { safeSignals: ["full-fiscal-year-recovery-stale"] },
    });
    expect(browser.storage.local.remove).not.toHaveBeenCalledWith("full-year-ledger");
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
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

function gstr2bDashboardViewClicked(period: FiledReturnsMonth): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
      state: "clicked",
      safeSignals: ["gstr2b-dashboard-view-clicked", `filed-return-result-period:${period}`],
      safeMessage: "Opened GSTR-2B summary from return dashboard.",
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
it("preserves an actionable full-year ledger when a different scope starts normally", async () => {
  mockLocalStorageGet({
    "full-year-ledger": createFullFiscalYearLedger({
      status: "blocked",
      currentPeriod: "April",
      targets: [{ period: "April", status: "blocked" }],
    }),
  });
  const sendMessageToTabWithInjection =
    vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

  const response = await startFiledReturnsDownloadFlow(
    {
      financialYear: "2025-26",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-1",
      artifactType: "PDF",
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
    flowStep: { safeSignals: expect.arrayContaining(["full-fiscal-year-run-needs-action"]) },
  });
  expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  expect(browser.storage.local.set).not.toHaveBeenCalledWith({
    "full-year-ledger": expect.objectContaining({
      scope: expect.objectContaining({ returnType: "GSTR-1" }),
    }),
  });
});

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

function filedGstr1DownloadReady(
  period: FiledReturnsMonth,
  artifactType: "PDF" | "EXCEL",
): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "ready",
      safeSignals: [
        "filed-return-download-ready",
        "filed-gstr1-download-ready",
        artifactType === "EXCEL" ? "download-excel-gstr-1" : "download-pdf-gstr-1",
        `filed-return-detail-period:${period}`,
      ],
      safeMessage: artifactType === "EXCEL" ? "Excel ready." : "Summary PDF ready.",
    },
  };
}

function gstr2bDashboardWaiting(): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
      state: "clicked",
      safeSignals: ["gstr2b-return-dashboard-loading"],
      safeMessage: "Waiting for GSTR-2B dashboard controls.",
    },
  };
}

function gstr2bDownloadReady(period: FiledReturnsMonth): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
      state: "ready",
      safeSignals: [
        "filed-return-download-ready",
        "filed-gstr2b-download-ready",
        `filed-return-detail-period:${period}`,
      ],
      safeMessage: "GSTR-2B ready.",
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

function filedGstr1DownloadClicked(artifactType: "PDF" | "EXCEL"): PackMessageResponse {
  return {
    ok: true,
    downloadTrigger: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "clicked",
      safeSignals: [
        "filed-return-download-clicked",
        "filed-gstr1-download-clicked",
        artifactType === "EXCEL" ? "text-download-excel-gstr1" : "download-pdf-gstr1-visible",
      ],
      safeMessage: artifactType === "EXCEL" ? "Clicked Excel download." : "Clicked PDF download.",
    },
  };
}

function gstr2bDownloadClicked(): PackMessageResponse {
  return {
    ok: true,
    downloadTrigger: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
      state: "clicked",
      safeSignals: ["filed-return-download-clicked", "filed-gstr2b-download-clicked"],
      safeMessage: "Clicked GSTR-2B download.",
    },
  };
}

function filedGstr1ExcelNoDetailsAvailable(): PackMessageResponse {
  return {
    ok: true,
    downloadTrigger: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "blocked",
      safeSignals: [
        "filed-return-download-clicked",
        "filed-gstr1-download-clicked",
        "filed-gstr1-excel-no-details-available",
      ],
      safeMessage:
        "The GST Portal reported that no e-invoice details are available for this filed GSTR-1 period.",
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

function mockSessionStorageGet(value: Record<string, unknown>): void {
  const sessionGet = browser.storage.session.get as unknown as {
    mockResolvedValue: (nextValue: Record<string, unknown>) => void;
  };
  sessionGet.mockResolvedValue(value);
}

function dataUrl(mimeType: string, body: string): string {
  return `data:${mimeType};base64,${globalThis.btoa(body)}`;
}

function dataUrlBytes(mimeType: string, bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mimeType};base64,${globalThis.btoa(binary)}`;
}

function portalSizedPdfBody(marker: string): string {
  return `%PDF-1.7 synthetic${marker} ${"x".repeat(21 * 1024)}\n%%EOF\n`;
}

function saneXlsxBytes(marker: string): Uint8Array {
  return createPortalGstr2bWorkbook(marker);
}

function actionIdFromScriptingDetails(details: unknown): string {
  const args =
    typeof details === "object" && details !== null && "args" in details ? details.args : null;
  const firstArg = Array.isArray(args) ? args[0] : null;
  if (typeof firstArg === "object" && firstArg !== null && "actionId" in firstArg) {
    return String(firstArg.actionId);
  }
  return "action-captured";
}

function dataUrlForScriptingDetails(details: unknown): string {
  const args =
    typeof details === "object" && details !== null && "args" in details ? details.args : null;
  const firstArg = Array.isArray(args) ? args[0] : null;
  const controlId =
    typeof firstArg === "object" && firstArg !== null && "controlId" in firstArg
      ? String(firstArg.controlId)
      : "";
  const signalPrefix =
    typeof firstArg === "object" && firstArg !== null && "signalPrefix" in firstArg
      ? String(firstArg.signalPrefix)
      : "";
  const marker = signalPrefix === "gstr2b" ? " GSTR-2B" : "";
  if (controlId.includes("excel")) {
    return dataUrlBytes(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      saneXlsxBytes(marker),
    );
  }
  return dataUrl("application/pdf", portalSizedPdfBody(marker));
}
