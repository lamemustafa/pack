import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PACK_CONTENT_REQUEST_ENVELOPE_TYPE,
  PACK_CONTENT_SCRIPT_PROTOCOL_VERSION,
} from "../../src/connectors/gst/messages";
import type { PackMessage, PackMessageResponse } from "../../src/connectors/gst/messages";
import { FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND } from "../../src/connectors/gst/filed-returns-contracts";
import { expandAllSupportedFullFiscalYearTargetPlan } from "../../src/connectors/gst/filed-returns-all-supported-full-fiscal-year";
import {
  getFiledReturnsFinancialYearOptions,
  getFiledReturnsFullFiscalYearPeriods,
} from "../../src/connectors/gst/filed-returns-scope";
import { createAllSupportedFullFiscalYearLedger } from "../../src/background/filed-returns-all-supported-full-fiscal-year-ledger";
import {
  allSupportedFullFiscalYearPlanRootKey,
  allSupportedFullFiscalYearPlanStorageKey,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year-run-state";
import { PACK_LOCAL_STORAGE_KEYS } from "../../src/background/storage-keys";

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
    setLocalStorage: (values: Record<string, unknown>) => {
      Object.assign(localStorageState, values);
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
          const payload = message.payload as {
            artifactType: "PDF" | "JSON" | "EXCEL";
            ledgerId: string;
            requestId: string;
            returnType: "GSTR-1" | "GSTR-2B" | "GSTR-3B";
            zipPath: string;
          };
          return {
            ok: true,
            requestId: payload.requestId,
            staged: true,
            byteCountClass: "non-empty",
            byteCount: 128,
            artifactType: payload.artifactType,
            ledgerId: payload.ledgerId,
            returnType: payload.returnType,
            zipPath: payload.zipPath,
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
            artifactEntryCount: 3,
            summaryEntryCount: 0,
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

  it("removes legacy durable completion markers when the worker starts", async () => {
    const legacyKey = "pack:filed-returns-target-review:completion:legacy";
    browserMocks.setLocalStorage({ [legacyKey]: { opaque: "legacy" } });

    await import("../../src/entrypoints/background");

    await vi.waitFor(() =>
      expect(browserMocks.storage.local.remove).toHaveBeenCalledWith([legacyKey]),
    );
    await expect(browserMocks.storage.local.get()).resolves.toEqual({});
  });

  it("shows the active all-supported ledger instead of its atomic compatibility lease", async () => {
    const now = new Date();
    const financialYear = getFiledReturnsFinancialYearOptions(now)[0]!;
    const periods = getFiledReturnsFullFiscalYearPeriods(financialYear, now);
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected all-supported full-year plan");
    const planRoot = {
      kind: FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
      financialYear,
    } as const;
    const ledger = createAllSupportedFullFiscalYearLedger(
      planRoot,
      expansion.targets,
      periods,
      now,
    );
    const leaseScope = ledger.targets[0]!;
    browserMocks.setLocalStorage({
      [PACK_LOCAL_STORAGE_KEYS.activeFiledReturnsRun]: {
        schemaVersion: "1.0",
        runId: "00000000-0000-4000-8000-000000000000",
        revision: 1,
        scope: {
          financialYear: leaseScope.financialYear,
          period: leaseScope.period,
          returnType: leaseScope.returnType,
          artifactType: leaseScope.artifactType,
        },
        status: "running",
        leaseUpdatedAt: now.toISOString(),
      },
      [PACK_LOCAL_STORAGE_KEYS.allSupportedFullFiscalYearLedgerIndex]: {
        schemaVersion: "1.0",
        ledgerIdsByPlanRoot: {
          [allSupportedFullFiscalYearPlanRootKey(planRoot)]: ledger.ledgerId,
        },
      },
      [allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId)]: ledger,
    });

    await import("../../src/entrypoints/background");

    await expect(
      sendBackgroundMessage({ type: "PACK_GET_FILED_RETURNS_FLOW_SUMMARY" }),
    ).resolves.toMatchObject({
      ok: true,
      allSupportedFullFiscalYearFlowSummary: {
        status: "running",
        summaryIdentity: planRoot,
        totalTargets: ledger.targets.length,
      },
    });
  });

  it("surfaces a stale all-supported compatibility lease so it can be acknowledged", async () => {
    const now = new Date(Date.now() - 60_000);
    const financialYear = getFiledReturnsFinancialYearOptions(now)[0]!;
    const periods = getFiledReturnsFullFiscalYearPeriods(financialYear, now);
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected all-supported full-year plan");
    const planRoot = {
      kind: FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
      financialYear,
    } as const;
    const ledger = createAllSupportedFullFiscalYearLedger(
      planRoot,
      expansion.targets,
      periods,
      now,
    );
    const leaseScope = ledger.targets[0]!;
    browserMocks.setLocalStorage({
      [PACK_LOCAL_STORAGE_KEYS.activeFiledReturnsRun]: {
        schemaVersion: "1.0",
        runId: "00000000-0000-4000-8000-000000000001",
        revision: 1,
        scope: {
          financialYear: leaseScope.financialYear,
          period: "FULL_FISCAL_YEAR",
          returnType: leaseScope.returnType,
          artifactType: leaseScope.artifactType,
        },
        status: "running",
        leaseUpdatedAt: now.toISOString(),
      },
      [PACK_LOCAL_STORAGE_KEYS.allSupportedFullFiscalYearLedgerIndex]: {
        schemaVersion: "1.0",
        ledgerIdsByPlanRoot: {
          [allSupportedFullFiscalYearPlanRootKey(planRoot)]: ledger.ledgerId,
        },
      },
      [allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId)]: ledger,
    });

    await import("../../src/entrypoints/background");

    await expect(
      sendBackgroundMessage({ type: "PACK_GET_FILED_RETURNS_FLOW_SUMMARY" }),
    ).resolves.toMatchObject({
      ok: true,
      flowSummary: {
        status: "blocked",
        flowStep: { safeSignals: ["filed-returns-run-needs-review"] },
      },
    });
  });

  it("leaves validated offscreen staging messages for the offscreen document", async () => {
    await import("../../src/entrypoints/background");
    const listener = browserMocks.getMessageListener();
    if (!listener) throw new Error("background listener was not registered");
    const sendResponse = vi.fn();

    const handled = listener(
      {
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
        target: "pack-offscreen-blob-url",
        payload: {
          requestId: "synthetic-stage-request",
          ledgerId: "00000000-0000-4000-8000-000000000000",
          zipPath: "april-return.pdf",
          returnType: "GSTR-3B",
          artifactType: "PDF",
          dataUrl: `data:application/pdf;base64,${globalThis.btoa("%PDF-1.7 synthetic\\n%%EOF\\n")}`,
        },
      },
      { id: browserMocks.runtime.id } satisfies Browser.runtime.MessageSender,
      sendResponse,
    );

    expect(handled).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("preserves an answered offscreen clear failure category", async () => {
    browserMocks.runtime.sendMessage.mockImplementationOnce(async (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "payload" in message &&
        typeof message.payload === "object" &&
        message.payload !== null &&
        "requestId" in message.payload
      ) {
        return {
          ok: false,
          requestId: message.payload.requestId,
          errorCategory: "clear-failed",
        } as never;
      }
      return { ok: false, errorCategory: "invalid-message" } as never;
    });
    const { clearOffscreenFiledReturnLedger } =
      await import("../../src/background/offscreen-blob-url");

    await expect(
      clearOffscreenFiledReturnLedger("single-period:synthetic-clear-test"),
    ).resolves.toEqual({ status: "failed", errorCategory: "clear-failed" });
  });

  it("distinguishes unreachable offscreen clear communication", async () => {
    browserMocks.runtime.sendMessage.mockRejectedValueOnce(new Error("synthetic unreachable"));
    const { clearAllOffscreenFiledReturnLedgers } =
      await import("../../src/background/offscreen-blob-url");

    await expect(clearAllOffscreenFiledReturnLedgers()).resolves.toEqual({
      status: "failed",
      errorCategory: "offscreen-unreachable",
    });
  });

  it("distinguishes an invalid answered offscreen clear response", async () => {
    browserMocks.runtime.sendMessage.mockResolvedValueOnce({
      ok: false,
      errorCategory: "invalid-message",
    } as never);
    const { clearAllOffscreenFiledReturnLedgers } =
      await import("../../src/background/offscreen-blob-url");

    await expect(clearAllOffscreenFiledReturnLedgers()).resolves.toEqual({
      status: "failed",
      errorCategory: "offscreen-response-invalid",
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

    if (!response.ok) throw new Error(response.error);

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

  it("returns a safe source when an unexpected background failure occurs", async () => {
    await import("../../src/entrypoints/background");
    browserMocks.storage.local.get.mockRejectedValueOnce(
      new Error("sensitive portal URL and local path must not escape"),
    );

    const response = await sendBackgroundMessage({ type: "PACK_GET_LAST_MANIFEST" });

    expect(response).toEqual({
      ok: false,
      error: "BACKGROUND_MESSAGE_HANDLER_FAILED",
      safeMessage: "Pack stopped while handling the local manifest request. Try the action again.",
      safeSite: "background-message-handler:last-manifest",
    });
    if (response.ok) throw new Error("expected a safe background failure");
    expect(response.safeMessage).not.toContain("portal URL");
    expect(response.safeMessage).not.toContain("local path");
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

  it("starts full-fiscal-year GSTR-3B acquisition without legacy downloads", async () => {
    const financialYear = "2026-27";
    let flowStepCalls = 0;
    browserMocks.tabs.sendMessage.mockImplementation(async (_tabId, message: PackMessage) => {
      message = unwrapContentRequest(message);
      if (message.type === "PACK_CONTENT_PING_V2") {
        return {
          ok: true,
          context: null,
          contentScriptVersion: PACK_CONTENT_SCRIPT_PROTOCOL_VERSION,
        } satisfies PackMessageResponse;
      }
      if (message.type === "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3") {
        flowStepCalls += 1;
        return {
          ok: true,
          flowStep: {
            connectorId: "gst",
            scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
            state: flowStepCalls === 1 ? "clicked" : "ready",
            safeSignals:
              flowStepCalls === 1
                ? ["filed-return-result-view-clicked"]
                : [
                    "gstr-3b-detail-route",
                    "filed-gstr3b-download-ready",
                    `filed-return-detail-period:${message.payload.period}`,
                  ],
            safeMessage:
              flowStepCalls === 1
                ? "Pack opened the selected GSTR-3B result."
                : "Pack found the selected GSTR-3B detail page.",
          },
        } satisfies PackMessageResponse;
      }
      if (message.type === "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34") {
        return {
          ok: true,
          artifact: {
            ok: false,
            reason: "generation-timeout",
            requestId: message.payload.requestId,
            safeSignals: [],
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

    if (!response.ok) throw new Error(response.error);

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining(["artifact-generation-timeout"]),
      },
    });
    expect(browserMocks.downloads.download).not.toHaveBeenCalled();
    expect(flowStepCalls).toBe(2);
    expect(sentActionMessageTypes()).toContain("PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34");
    expect(sentActionMessageTypes()).not.toContain("PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3");
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
