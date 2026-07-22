import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackMessage, PackMessageResponse } from "../../src/core/messages";

const browserMocks = vi.hoisted(() => {
  const localValues: Record<string, unknown> = {};
  const sessionValues: Record<string, unknown> = {};
  const resetLocalStorage = () => {
    for (const key of Object.keys(localValues)) delete localValues[key];
    localValues["pack:local-processing-acknowledgement"] = {
      version: "2026-07-21-v1",
      acknowledgedAt: "2026-07-21T00:00:00.000Z",
    };
  };
  const resetSessionStorage = () => {
    for (const key of Object.keys(sessionValues)) delete sessionValues[key];
  };
  resetLocalStorage();
  let messageListener:
    | ((
        message: unknown,
        sender: Browser.runtime.MessageSender,
        sendResponse: (response: PackMessageResponse) => void,
      ) => boolean | undefined)
    | null = null;

  return {
    resetLocalStorage,
    resetSessionStorage,
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
        get: vi.fn(async (key?: unknown) => {
          if (typeof key === "string") {
            return key in localValues ? { [key]: localValues[key] } : {};
          }
          if (Array.isArray(key)) {
            return Object.fromEntries(
              key
                .filter(
                  (entry): entry is string => typeof entry === "string" && entry in localValues,
                )
                .map((entry) => [entry, localValues[entry]]),
            );
          }
          return { ...localValues };
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete localValues[key];
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(localValues, values);
        }),
        setAccessLevel: vi.fn(async () => undefined),
      },
      session: {
        get: vi.fn(async (key?: unknown) => {
          if (typeof key === "string") {
            return key in sessionValues ? { [key]: sessionValues[key] } : {};
          }
          return { ...sessionValues };
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(sessionValues, values);
        }),
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
  beforeEach(() => {
    vi.clearAllMocks();
    browserMocks.resetLocalStorage();
    browserMocks.resetSessionStorage();
    vi.resetModules();
    vi.useRealTimers();
    vi.stubGlobal("defineBackground", (entrypoint: () => void) => {
      entrypoint();
      return entrypoint;
    });
  });

  it("blocks a live start until the local-processing acknowledgement is current", async () => {
    await browserMocks.storage.local.remove("pack:local-processing-acknowledgement");
    await import("../../src/entrypoints/background");

    const response = await sendBackgroundMessage({
      type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
      payload: {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
    });

    expect(response).toEqual({
      ok: false,
      error:
        "Review and acknowledge Pack's local-processing boundary before starting or retrying a GST download.",
    });
    expect(browserMocks.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects a portal-click fallback that did not originate from the Pack popup", async () => {
    await import("../../src/entrypoints/background");

    const response = await sendBackgroundMessage({
      type: "PACK_RETRY_FILED_RETURNS_PORTAL_CLICK",
      payload: {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
    });

    expect(response).toEqual({ ok: false, error: "Invalid Pack sender." });
    expect(browserMocks.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("accepts the portal-click fallback only from the Pack popup", async () => {
    await import("../../src/entrypoints/background");

    const response = await sendBackgroundMessage(
      {
        type: "PACK_RETRY_FILED_RETURNS_PORTAL_CLICK",
        payload: {
          financialYear: "2026-27",
          period: "May",
          returnType: "GSTR-3B",
        },
      },
      {
        id: browserMocks.runtime.id,
        url: browserMocks.runtime.getURL("/popup.html"),
      } satisfies Browser.runtime.MessageSender,
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: { safeSignals: ["filed-returns-target-review-not-found"] },
    });
    expect(browserMocks.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("exports an optional receipt only for the current verified single-period summary", async () => {
    await import("../../src/entrypoints/background");
    await browserMocks.storage.session.set({
      "pack:last-filed-returns-flow-summary": {
        scope: {
          artifactType: "PDF",
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-3B",
        },
        status: "complete",
        completedAt: "2026-07-21T01:02:03.000Z",
        completedPeriods: ["May"],
        totalPeriods: 1,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "downloaded",
          safeSignals: ["browser-download-non-empty"],
          safeMessage: "Verified.",
        },
      },
    });

    const response = await sendBackgroundMessage({
      type: "PACK_EXPORT_FILED_RETURNS_RECEIPT",
      payload: {
        artifactType: "PDF",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-3B",
      },
    });

    expect(response).toEqual({ ok: true, receiptDownload: "requested" });
    expect(browserMocks.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        conflictAction: "uniquify",
        filename: "ComplyEaze-Pack/Receipts/gstr-3b-2025-26-may-receipt.json",
        saveAs: false,
        url: expect.stringMatching(/^data:application\/json;charset=utf-8,/),
      }),
    );
  });

  it("fails closed when trusted local-storage initialization cannot complete", async () => {
    browserMocks.storage.local.setAccessLevel.mockRejectedValueOnce(
      new Error("storage access level rejected"),
    );
    await import("../../src/entrypoints/background");

    const response = await sendBackgroundMessage({
      type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
      payload: {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
    });

    expect(response).toEqual({
      ok: false,
      error:
        "Pack could not initialize private local storage. Reload the extension before starting a GST download.",
    });
    expect(browserMocks.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("requires an explicit local-data reset after legacy state is quarantined", async () => {
    await import("../../src/entrypoints/background");
    await browserMocks.storage.local.set({
      "pack:filed-returns-state-migration": {
        schemaVersion: "1.0",
        source: "v0.4.x",
        state: "quarantined",
        updatedAt: "2026-07-21T00:00:00.000Z",
        quarantinedKeys: ["active-run"],
      },
    });

    const response = await sendBackgroundMessage({
      type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
      payload: {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
    });

    expect(response).toEqual({
      ok: false,
      error:
        "Pack isolated legacy local state whose outcome cannot be verified. Check browser Downloads, then open Pack Options and clear local Pack data before starting a new download.",
    });
    expect(browserMocks.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("prefers target-bound portal capture over the unreliable direct request", async () => {
    browserMocks.tabs.sendMessage.mockImplementation(async (_tabId, message: PackMessage) => {
      message = unwrapContentRequest(message);
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
          "filed-gstr3b-extension-download-started",
          "browser-download-completed",
        ]),
      },
    });
    expect(browserMocks.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        conflictAction: "uniquify",
        filename: "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf",
        saveAs: false,
      }),
    );
    expect(sentActionMessageTypes()).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
  });

  it("blocks full-fiscal-year execution before any portal or download action", async () => {
    const financialYear = "2026-27";
    browserMocks.tabs.sendMessage.mockImplementation(async (_tabId, message: PackMessage) => {
      message = unwrapContentRequest(message);
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
        state: "blocked",
        safeSignals: ["full-fiscal-year-temporarily-paused"],
      },
      flowSummary: {
        completedPeriods: [],
        status: "blocked",
        totalPeriods: 12,
      },
    });
    expect(browserMocks.downloads.download).not.toHaveBeenCalled();
    expect(browserMocks.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("does not use the GSTR-3B direct-download resolver for GSTR-2B", async () => {
    browserMocks.tabs.sendMessage.mockImplementation(async (_tabId, message: PackMessage) => {
      message = unwrapContentRequest(message);
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
          schemaVersion: "1.0",
          localOnly: true,
          uploadedToComplyEaze: false,
        }),
      }),
    );
    const persistedManifest = browserMocks.storage.local.set.mock.calls
      .map((call) => call[0]["pack:last-manifest"])
      .find((value) => value !== undefined);
    expect(JSON.stringify(persistedManifest)).not.toContain("documents");
    expect(JSON.stringify(persistedManifest)).not.toContain("subject");

    const storedResponse = await sendBackgroundMessage({ type: "PACK_GET_LAST_MANIFEST" });
    expect(storedResponse).toMatchObject({
      ok: true,
      manifest: {
        schemaVersion: "1.0",
        localOnly: true,
        uploadedToComplyEaze: false,
      },
    });
    if (!storedResponse.ok || !("manifest" in storedResponse) || !storedResponse.manifest) {
      throw new Error("Expected a persisted manifest summary.");
    }
    expect(Object.keys(storedResponse.manifest).sort()).toEqual([
      "completionState",
      "downloaded",
      "exceptionCount",
      "generatedAt",
      "localOnly",
      "schemaVersion",
      "totalPlanned",
      "uploadedToComplyEaze",
    ]);
  });

  it("drops a legacy full manifest instead of exposing it as a local summary", async () => {
    await browserMocks.storage.local.set({
      "pack:last-manifest": {
        schema_version: "1.0",
        subject: { display_label: "synthetic-subject" },
        documents: [{ originalFilename: "synthetic.pdf" }],
      },
    });
    await import("../../src/entrypoints/background");

    const response = await sendBackgroundMessage({ type: "PACK_GET_LAST_MANIFEST" });

    expect(response).toEqual({ ok: true, manifest: null });
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith("pack:last-manifest");
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

async function sendBackgroundMessage(
  message: PackMessage,
  sender: Browser.runtime.MessageSender = { id: browserMocks.runtime.id },
): Promise<PackMessageResponse> {
  const listener = browserMocks.getMessageListener();
  if (!listener) throw new Error("background listener was not registered");

  return new Promise((resolve) => {
    listener(message, sender, resolve);
  });
}

function sentActionMessageTypes(): string[] {
  return browserMocks.tabs.sendMessage.mock.calls
    .map(([, message]) => unwrapContentRequest(message as PackMessage).type)
    .filter((type) => type !== "PACK_CONTENT_PING_V2");
}

function unwrapContentRequest(message: unknown): PackMessage {
  if (
    message &&
    typeof message === "object" &&
    "type" in message &&
    message.type === "PACK_CONTENT_REQUEST_V31" &&
    "payload" in message &&
    message.payload &&
    typeof message.payload === "object"
  ) {
    return message.payload as PackMessage;
  }
  return message as PackMessage;
}
