import { beforeEach, describe, expect, it, vi } from "vitest";
import { PACK_CONTENT_REQUEST_ENVELOPE_TYPE } from "../../src/connectors/gst/messages";
import { type FiledReturnsMonth } from "../../src/connectors/gst/filed-returns-scope";
import type { PackMessage, PackMessageResponse } from "../../src/connectors/gst/messages";

const browserMocks = vi.hoisted(() => {
  let messageListener:
    | ((
        message: unknown,
        sender: Browser.runtime.MessageSender,
        sendResponse: (response: PackMessageResponse) => void,
      ) => boolean | undefined)
    | null = null;
  let localStorageState: Record<string, unknown> = {};
  let sessionStorageState: Record<string, unknown> = {};

  return {
    getMessageListener: () => messageListener,
    resetLocalStorage: () => {
      localStorageState = {};
    },
    resetSessionStorage: () => {
      sessionStorageState = {};
    },
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
      executeScript: vi.fn(
        async (details: { args?: [{ actionId?: string; signalPrefix?: string }] }) => {
          const signalPrefix = details.args?.[0]?.signalPrefix ?? "filed-gstr3b";
          return [
            {
              result: {
                capturedDownloadRequest: {
                  actionId: details.args?.[0]?.actionId ?? "action-captured",
                  dataUrl: `data:application/pdf;base64,${globalThis.btoa("%PDF-1.7 synthetic\n%%EOF\n")}`,
                  safeSignals: [
                    `${signalPrefix}-portal-blob-captured`,
                    `${signalPrefix}-native-blob-click-suppressed`,
                    `${signalPrefix}-main-world-capture`,
                  ],
                },
                safeFailureSignals: [],
              },
            },
          ];
        },
      ),
    },
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | Record<string, unknown>) => {
          if (typeof keys === "string") {
            return keys in localStorageState ? { [keys]: localStorageState[keys] } : {};
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(
              keys
                .filter((key) => key in localStorageState)
                .map((key) => [key, localStorageState[key]]),
            );
          }
          if (keys && typeof keys === "object") {
            return Object.fromEntries(
              Object.entries(keys).map(([key, fallback]) => [
                key,
                key in localStorageState ? localStorageState[key] : fallback,
              ]),
            );
          }
          return { ...localStorageState };
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete localStorageState[key];
          }
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(localStorageState, values);
        }),
        setAccessLevel: vi.fn(async () => undefined),
      },
      session: {
        get: vi.fn(async (keys?: string | string[] | Record<string, unknown>) => {
          if (typeof keys === "string") {
            return keys in sessionStorageState ? { [keys]: sessionStorageState[keys] } : {};
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(
              keys
                .filter((key) => key in sessionStorageState)
                .map((key) => [key, sessionStorageState[key]]),
            );
          }
          if (keys && typeof keys === "object") {
            return Object.fromEntries(
              Object.entries(keys).map(([key, fallback]) => [
                key,
                key in sessionStorageState ? sessionStorageState[key] : fallback,
              ]),
            );
          }
          return { ...sessionStorageState };
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete sessionStorageState[key];
          }
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(sessionStorageState, values);
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
    safeEvidence: {
      byteCountClass: "non-empty",
      downloadId: 481,
      mimeClass: "pdf",
      urlClass: "blob",
    },
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

describe("background filed returns download defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useRealTimers();
    browserMocks.resetLocalStorage();
    browserMocks.resetSessionStorage();
    vi.stubGlobal("defineBackground", (entrypoint: () => void) => {
      entrypoint();
      return entrypoint;
    });
  });

  it("uses the authenticated-page GSTR-3B acquisition request instead of legacy capture", async () => {
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

      if (message.type === "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34") {
        return {
          ok: false,
          error: "CONTENT_SCRIPT_UNAVAILABLE",
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
        state: "blocked",
        safeSignals: ["artifact-acquisition-failed", "artifact-response-missing"],
      },
    });
    expect(browserMocks.downloads.download).not.toHaveBeenCalled();
    expect(sentActionMessageTypes()).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34",
    ]);
  });

  it("persists and returns a terminal GSTR-2B mismatch summary to the popup", async () => {
    browserMocks.tabs.query.mockResolvedValueOnce([
      {
        active: true,
        id: 17,
        url: "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
        windowId: 1,
      },
    ]);
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
              "download-gstr2b-summary-pdf",
              "download-gstr2b-details-excel",
              "filed-gstr2b-download-ready",
            ],
            safeMessage: "GSTR-2B download controls appear ready.",
          },
        } satisfies PackMessageResponse;
      }
      if (message.type === "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34") {
        return {
          ok: true,
          artifact: {
            ok: false,
            reason: "target-period-mismatch",
            requestId: "synthetic-request",
            safeSignals: [],
          },
        } satisfies PackMessageResponse;
      }
      return { ok: false, error: "Unexpected message." } satisfies PackMessageResponse;
    });

    await import("../../src/entrypoints/background");

    const response = await sendBackgroundMessage({
      type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
      payload: { financialYear: "2026-27", period: "April", returnType: "GSTR-2B" },
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "artifact-acquisition-failed",
          "artifact-target-period-mismatch",
        ]),
        safeMessage:
          "The GST Portal returned artifact data for a different requested return period.",
      },
      flowSummary: { status: "blocked" },
    });
    expect(browserMocks.storage.session.set).toHaveBeenCalledWith({
      "pack:last-filed-returns-flow-summary": expect.objectContaining({
        status: "blocked",
        flowStep: expect.objectContaining({
          safeSignals: expect.arrayContaining([
            "artifact-acquisition-failed",
            "artifact-target-period-mismatch",
          ]),
        }),
      }),
    });

    await expect(
      sendBackgroundMessage({ type: "PACK_GET_FILED_RETURNS_FLOW_SUMMARY" }),
    ).resolves.toMatchObject({
      ok: true,
      flowSummary: {
        status: "blocked",
        flowStep: {
          safeMessage: expect.stringMatching(/\S/),
        },
      },
    });
  });

  it("blocks a full-fiscal-year GSTR-3B request before it can start legacy targets", async () => {
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
          downloadTrigger: {
            connectorId: "gst",
            scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
            state: "clicked",
            safeSignals: ["filed-gstr3b-download-clicked"],
            safeMessage: "Clicked.",
          },
          mainWorldCaptureRequest: {
            actionId: message.payload.actionId,
            asyncBlobBinding: "action-xhr-non-artifact-to-pdf",
            controlAttribute: "data-pack-gstr2b-capture-action",
            controlId: `capture-${message.payload.period.toLowerCase()}`,
            maxBytes: 36 * 1024 * 1024,
            signalPrefix: "filed-gstr3b",
            targetBinding: testCaptureBinding(message.payload, "PDF"),
            timeoutMs: 30_000,
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
        safeSignals: ["gstr3b-full-fiscal-year-acquisition-not-wired"],
      },
    });
    expect(browserMocks.downloads.download).not.toHaveBeenCalled();
    expect(sentActionMessageTypes()).toEqual([]);
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

function testCaptureBinding(
  target: Extract<
    PackMessage,
    { type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" }
  >["payload"],
  artifactType: "PDF" | "EXCEL",
) {
  return {
    artifactType,
    controlTextDigest: "1234abcd",
    financialYear: target.financialYear,
    pathnameDigest: "abcd1234",
    period: target.period as FiledReturnsMonth,
    returnType: target.returnType,
  };
}

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
    .map(([, message]) => unwrapContentRequest(message as PackMessage).type)
    .filter((type) => type !== "PACK_CONTENT_PING_V2");
}

function unwrapContentRequest(message: unknown): PackMessage {
  if (
    message &&
    typeof message === "object" &&
    "type" in message &&
    message.type === PACK_CONTENT_REQUEST_ENVELOPE_TYPE &&
    "payload" in message &&
    message.payload &&
    typeof message.payload === "object"
  ) {
    return message.payload as PackMessage;
  }
  return message as PackMessage;
}
