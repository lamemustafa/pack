import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFiledReturnsFullFiscalYearPeriods } from "../../src/core/filed-returns-scope";
import type { PackMessage, PackMessageResponse } from "../../src/core/messages";
import { observeBrowserDownloadById } from "../../src/background/download-observer";

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
    offscreen: {
      closeDocument: vi.fn(async () => undefined),
      createDocument: vi.fn(async () => undefined),
    },
    runtime: {
      getContexts: vi.fn(async () => []),
      getURL: vi.fn((path: string) => `chrome-extension://pack/${path}`),
      getManifest: vi.fn(() => ({ version: "0.3.3" })),
      id: "pack-test-extension",
      onInstalled: {
        addListener: vi.fn(),
      },
      onMessage: {
        addListener: vi.fn((listener) => {
          messageListener = listener;
        }),
      },
      sendMessage: vi.fn(async (message: unknown) => {
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
            blobUrl: "blob:chrome-extension://pack/download-prompt-probe",
          };
        }
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
            zipEntryCount: 3,
          };
        }
        return { ok: false, errorCategory: "invalid-message" };
      }),
    },
    scripting: {
      executeScript: vi.fn(async (details: { args?: [{ actionId?: string }] }) => [
        {
          result: {
            actionId: details.args?.[0]?.actionId ?? "action-captured",
            dataUrl: `data:application/pdf;base64,${globalThis.btoa("%PDF-1.7 synthetic\n%%EOF\n")}`,
            safeSignals: ["portal-blob-captured", "native-blob-click-suppressed"],
          },
        },
      ]),
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

  it("stages full-fiscal-year monthly targets and exports one zip", async () => {
    const financialYear = "2026-27";
    const periods = getFiledReturnsFullFiscalYearPeriods(financialYear);
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

      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        return {
          ok: true,
          mainWorldCaptureRequest: {
            actionId: message.payload.actionId,
            controlAttribute: "data-pack-download-action-id",
            controlId: message.payload.actionId,
            maxBytes: 10_000_000,
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
            ],
            safeMessage: "Captured.",
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
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-complete",
          "full-fiscal-year-opfs-cleared",
          "full-fiscal-year-zip-downloaded",
        ]),
      },
      flowSummary: {
        completedPeriods: periods,
        status: "complete",
        totalPeriods: periods.length,
      },
    });
    expect(browserMocks.downloads.download).toHaveBeenCalledTimes(1);
    expect(browserMocks.downloads.download).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: `gstr-3b-${financialYear.toLowerCase()}-full-year.zip`,
      saveAs: false,
      url: "blob:chrome-extension://pack/full-year.zip",
    });
    expect(observeBrowserDownloadById).toHaveBeenCalledWith(
      browserMocks.downloads,
      481,
      expect.objectContaining({
        expectedFileExtensions: [".zip"],
        trustedDownloadIds: new Set([481]),
      }),
      90 * 1000,
    );
    expect(browserMocks.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
        payload: expect.objectContaining({
          ledgerId: expect.any(String),
        }),
      }),
    );
    periods.forEach((period) => {
      expect(browserMocks.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
          payload: expect.objectContaining({
            zipPath: `${period.toLowerCase()}.pdf`,
          }),
        }),
      );
    });
    expect(sentActionMessageTypes()).toEqual([
      ...periods.flatMap(() => [
        "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
        "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
        "PACK_CONTENT_PREPARE_MAIN_WORLD_CAPTURE_V3",
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

  it("builds the options-page synthetic demo manifest without starting downloads by default", async () => {
    await import("../../src/entrypoints/background");

    const response = await sendBackgroundMessage({
      type: "PACK_START_SYNTHETIC_DEMO",
      payload: { downloadArtifacts: false },
    });
    if (!response.ok) throw new Error(response.error);

    expect(response).toMatchObject({
      ok: true,
      downloaded: 0,
      manifest: {
        privacy: {
          local_only: true,
          uploaded_to_complyeaze: false,
        },
      },
    });
    expect(browserMocks.downloads.download).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        "pack:last-manifest": expect.objectContaining({
          privacy: expect.objectContaining({
            local_only: true,
            uploaded_to_complyeaze: false,
          }),
        }),
      }),
    );
  });

  it("runs the one-file download prompt probe with saveAs false", async () => {
    await import("../../src/entrypoints/background");

    const response = await sendBackgroundMessage({
      type: "PACK_RUN_DOWNLOAD_PROMPT_PROBE",
    });

    expect(response).toMatchObject({
      ok: true,
      downloadPromptProbe: {
        status: "started",
        downloadId: 481,
        filenameClass: "synthetic-download-prompt-probe",
        saveAsFalse: true,
        sourceClass: "data-url",
        safeSignals: expect.arrayContaining([
          "download-prompt-probe-started",
          "download-prompt-probe-save-as-false",
          "download-prompt-probe-source:data-url",
        ]),
      },
    });
    expect(browserMocks.downloads.download).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "Pack-Diagnostics/download-prompt-probe.txt",
      saveAs: false,
      url: expect.stringMatching(/^data:text\/plain;charset=utf-8;base64,/),
    });
  });

  it("runs the offscreen Blob URL prompt probe with saveAs false", async () => {
    await import("../../src/entrypoints/background");

    const response = await sendBackgroundMessage({
      type: "PACK_RUN_DOWNLOAD_PROMPT_PROBE",
      payload: { sourceClass: "offscreen-blob-url" },
    });

    expect(response).toMatchObject({
      ok: true,
      downloadPromptProbe: {
        status: "started",
        downloadId: 481,
        filenameClass: "synthetic-download-prompt-probe",
        saveAsFalse: true,
        sourceClass: "offscreen-blob-url",
        safeSignals: expect.arrayContaining([
          "download-prompt-probe-started",
          "download-prompt-probe-save-as-false",
          "download-prompt-probe-source:offscreen-blob-url",
        ]),
      },
    });
    expect(browserMocks.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_CREATE_BLOB_URL",
      }),
    );
    expect(browserMocks.downloads.download).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "Pack-Diagnostics/download-prompt-probe.txt",
      saveAs: false,
      url: "blob:chrome-extension://pack/download-prompt-probe",
    });
  });

  it("reports prompt probe start rejection without raw error details", async () => {
    browserMocks.downloads.download.mockRejectedValueOnce(new Error("native failure detail"));
    await import("../../src/entrypoints/background");

    const response = await sendBackgroundMessage({
      type: "PACK_RUN_DOWNLOAD_PROMPT_PROBE",
    });

    expect(response).toMatchObject({
      ok: true,
      downloadPromptProbe: {
        status: "start-rejected",
        filenameClass: "synthetic-download-prompt-probe",
        saveAsFalse: true,
        sourceClass: "data-url",
        safeSignals: expect.arrayContaining([
          "download-prompt-probe-start-rejected",
          "download-prompt-probe-save-as-false",
        ]),
      },
    });
    expect(JSON.stringify(response)).not.toContain("native failure detail");
  });

  it("keeps explicit synthetic artifact downloads available for controlled review", async () => {
    await import("../../src/entrypoints/background");

    const response = await sendBackgroundMessage({
      type: "PACK_START_SYNTHETIC_DEMO",
      payload: { downloadArtifacts: true },
    });
    if (!response.ok) throw new Error(response.error);

    expect(response).toMatchObject({
      ok: true,
      downloaded: 10,
    });
    expect(browserMocks.downloads.download).toHaveBeenCalledTimes(10);
    expect(browserMocks.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        conflictAction: "uniquify",
        filename: expect.stringMatching(/^Pack-Demo\/FY-2023-24-/),
        saveAs: false,
      }),
    );
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
