import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackMessageResponse } from "../../src/connectors/gst/messages";
import {
  FILED_RETURNS_MONTHS,
  FULL_FISCAL_YEAR_PERIOD,
  type FiledReturnsMonth,
} from "../../src/connectors/gst/filed-returns-scope";
import type {
  FiledReturnsDownloadDiagnostic,
  FiledReturnsDownloadTarget,
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsMainWorldCaptureRequest,
} from "../../src/connectors/gst/filed-returns-contracts";
import {
  resolveFullFiscalYearTargetFlow,
  resolveUnconfirmedFiledReturnsDownloadFlow,
  retryFullFiscalYearTargetDownloadFlow,
  startFiledReturnsDownloadFlow,
  retryFiledReturnsTargetDownloadFlow,
  startFreshFiledReturnsDownloadFlow,
  type ActiveGstTab,
  type FiledReturnsFlowRunnerDeps,
} from "../../src/background/filed-returns-flow-runner";
import {
  observeBrowserDownloadById,
  type DownloadCreatedItem,
} from "../../src/background/download-observer";
import {
  exportFullFiscalYearZip,
  exportSinglePeriodFiledReturnsZip,
} from "../../src/background/filed-returns-full-fiscal-year-zip";
import { startCapturedFiledReturnDownload } from "../../src/background/filed-returns-captured-download";
import {
  requireFullFiscalYearArtifactsStaged,
  scopeForFullFiscalYearTarget,
} from "../../src/background/filed-returns-full-fiscal-year-artifacts";
import { FULL_FISCAL_YEAR_PLAN_VERSION } from "../../src/background/filed-returns-full-fiscal-year-plan";
import { markFullFiscalYearRestagingRequired } from "../../src/background/filed-returns-full-fiscal-year-cleanup";
import { MAX_GSTR1_FLOW_STEPS } from "../../src/background/filed-returns-flow-runner-utils";
import { createPortalGstr2bWorkbook } from "../fixtures/gstr2b-workbook";
import { browser } from "wxt/browser";
import { GST_CONNECTOR_DESCRIPTOR } from "../../src/connectors/gst/constants";
import { PACK_PRODUCT_VERSION } from "../../src/extension/version";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import { isDurableFiledReturnsSignal } from "../../src/connectors/gst/filed-returns-durable-signals";

const GST_RETURNS_ORIGIN = "https://return.gst.gov.in";
const FULL_FISCAL_YEAR_LEDGER_ID = "full-fiscal-year-12345678";
const ACTIVE_RUN_ID = "filed-returns-run-12345678";

type RuntimeMock = typeof browser.runtime & {
  getContexts: ReturnType<typeof vi.fn<() => Promise<unknown[]>>>;
};

let stagedZipEntryCount = 0;
let localStorageValues: Record<string, unknown> = {};

vi.mock("wxt/browser", () => ({
  browser: {
    downloads: {
      download: vi.fn(async () => 81),
      search: vi.fn(async () => []),
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
          stagedZipEntryCount += 1;
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
            zipEntryCount: stagedZipEntryCount,
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
      executeScript: vi.fn(async (details: { args?: unknown[] }) => {
        const request = details.args?.[0] as
          { actionId?: string; controlId?: string; signalPrefix?: string } | undefined;
        const signalPrefix = request?.signalPrefix ?? "filed-return";
        const isExcel = request?.controlId?.toLowerCase().includes("excel") ?? false;
        const mimeType = isExcel
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf";
        const body = isExcel ? "PK synthetic workbook" : "%PDF-1.7 synthetic\n%%EOF\n";
        return [
          {
            result: {
              capturedDownloadRequest: {
                actionId: request?.actionId ?? "missing-action",
                dataUrl: `data:${mimeType};base64,${globalThis.btoa(body)}`,
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
      }),
    },
    storage: {
      session: {
        get: vi.fn(async () => ({})),
        remove: vi.fn(async () => undefined),
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

function combinedMayZipEntryPlan() {
  return {
    artifactTypes: ["PDF" as const, "EXCEL" as const],
    unavailableArtifactTypes: [],
  };
}

function singlePeriodZipCheckpointOptions() {
  return {
    onAfterStagingCleared: vi.fn(async () => undefined),
    onBeforeDownloadStart: vi.fn(async () => undefined),
    onDownloadStarted: vi.fn(async () => undefined),
  };
}

describe("filed returns flow runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stagedZipEntryCount = 0;
    localStorageValues = {};
    (
      browser.downloads.download as unknown as {
        mockResolvedValue: (downloadId: number) => void;
      }
    ).mockResolvedValue(81);
    vi.mocked(browser.storage.local.get).mockImplementation(async (keys) => {
      if (typeof keys === "string") {
        return Object.hasOwn(localStorageValues, keys) ? { [keys]: localStorageValues[keys] } : {};
      }
      if (Array.isArray(keys)) {
        return Object.fromEntries(
          keys
            .filter((key) => Object.hasOwn(localStorageValues, key))
            .map((key) => [key, localStorageValues[key]]),
        );
      }
      return { ...localStorageValues };
    });
    vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
      Object.assign(localStorageValues, values);
    });
    vi.mocked(browser.storage.local.remove).mockImplementation(async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete localStorageValues[key];
    });
    vi.mocked(browser.storage.session.set).mockResolvedValue(undefined);
    vi.mocked(observeBrowserDownloadById).mockResolvedValue({
      state: "completed",
      safeSignals: ["browser-download-completed", "browser-download-non-empty"],
      safeMessage: "Completed.",
      safeEvidence: {
        byteCountClass: "non-empty",
        downloadId: 81,
        mimeClass: "pdf",
        urlClass: "https",
      },
    });
    mockDownloadSearch([]);
    const runtimeMock = browser.runtime as RuntimeMock;
    vi.mocked(runtimeMock.sendMessage).mockReset();
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
        stagedZipEntryCount += 1;
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
          zipEntryCount: stagedZipEntryCount,
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
      { result: mainWorldSuccessOutcomeForScriptingDetails(details) },
    ]);
    mockLocalStorageGet({});
    mockSessionStorageGet({});
  });

  it("runs a full fiscal year through concrete monthly targets without sending a full-year sentinel to content", async () => {
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      if (message.type === "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3") {
        return filedReturnRowOpened(message.payload.period as FiledReturnsMonth);
      }
      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        return {
          ok: true,
          mainWorldCaptureRequest: {
            actionId: message.payload.actionId,
            controlAttribute: "data-pack-gstr2b-capture-action",
            controlId: `control-${message.payload.period.toLowerCase()}`,
            maxBytes: 36 * 1024 * 1024,
            signalPrefix: "filed-gstr3b",
            targetBinding: testCaptureBindingFromTarget(message.payload),
            timeoutMs: 30_000,
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
        } as PackMessageResponse;
      }
      return { ok: false, error: "Unexpected call." };
    });

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
    expect(browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(observeBrowserDownloadById).toHaveBeenCalledTimes(1);
    const exportPendingLedgerCallIndex = vi
      .mocked(browser.storage.local.set)
      .mock.calls.findIndex(([value]) => {
        const ledger = (value as Record<string, unknown>)["full-year-ledger"];
        return (
          typeof ledger === "object" &&
          ledger !== null &&
          (ledger as Record<string, unknown>).status === "blocked" &&
          (ledger as Record<string, unknown>).zipPhase === "export-pending"
        );
      });
    expect(exportPendingLedgerCallIndex).toBeGreaterThanOrEqual(0);
    expect(
      vi.mocked(browser.storage.local.set).mock.invocationCallOrder[exportPendingLedgerCallIndex]!,
    ).toBeLessThan(vi.mocked(browser.downloads.download).mock.invocationCallOrder[0]!);
    const downloadIntentLedgerCallIndex = vi
      .mocked(browser.storage.local.set)
      .mock.calls.findIndex(([value]) => {
        const ledger = (value as Record<string, unknown>)["full-year-ledger"];
        return (
          typeof ledger === "object" &&
          ledger !== null &&
          (ledger as Record<string, unknown>).status === "blocked" &&
          (ledger as Record<string, unknown>).zipPhase === "download-intent-persisted" &&
          typeof (ledger as Record<string, unknown>).zipDownloadAttempt === "object"
        );
      });
    expect(downloadIntentLedgerCallIndex).toBeGreaterThanOrEqual(0);
    expect(
      vi.mocked(browser.storage.local.set).mock.invocationCallOrder[downloadIntentLedgerCallIndex]!,
    ).toBeLessThan(vi.mocked(browser.downloads.download).mock.invocationCallOrder[0]!);
    const downloadObservingLedgerCallIndex = vi
      .mocked(browser.storage.local.set)
      .mock.calls.findIndex(([value]) => {
        const ledger = (value as Record<string, unknown>)["full-year-ledger"];
        return (
          typeof ledger === "object" &&
          ledger !== null &&
          (ledger as Record<string, unknown>).zipPhase === "download-observing" &&
          ((ledger as Record<string, unknown>).zipDownloadAttempt as Record<string, unknown>)
            ?.downloadId === 81
        );
      });
    expect(downloadObservingLedgerCallIndex).toBeGreaterThanOrEqual(0);
    expect(vi.mocked(browser.downloads.download).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(browser.storage.local.set).mock.invocationCallOrder[
        downloadObservingLedgerCallIndex
      ]!,
    );
    expect(
      vi.mocked(browser.storage.local.set).mock.invocationCallOrder[
        downloadObservingLedgerCallIndex
      ]!,
    ).toBeLessThan(vi.mocked(observeBrowserDownloadById).mock.invocationCallOrder[0]!);
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
    const cleanupPendingLedgerCallIndex = vi
      .mocked(browser.storage.local.set)
      .mock.calls.findIndex(([value]) => {
        const ledger = (value as Record<string, unknown>)["full-year-ledger"];
        return (
          typeof ledger === "object" &&
          ledger !== null &&
          (ledger as Record<string, unknown>).status === "blocked" &&
          (ledger as Record<string, unknown>).zipPhase === "downloaded-cleanup-pending"
        );
      });
    const clearStagingCallIndex = vi
      .mocked(browser.runtime.sendMessage)
      .mock.calls.findIndex(
        ([message]) =>
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          (message as unknown as Record<string, unknown>).type ===
            "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
      );
    expect(cleanupPendingLedgerCallIndex).toBeGreaterThanOrEqual(0);
    expect(clearStagingCallIndex).toBeGreaterThanOrEqual(0);
    expect(
      vi.mocked(browser.storage.local.set).mock.invocationCallOrder[cleanupPendingLedgerCallIndex]!,
    ).toBeLessThan(
      vi.mocked(browser.runtime.sendMessage).mock.invocationCallOrder[clearStagingCallIndex]!,
    );
  });

  it("stages all 12 target-bound GSTR-3B PDFs and downloads exactly one full-year ZIP", async () => {
    const capturedTargets: Array<{
      actionId: string;
      period: FiledReturnsMonth;
    }> = [];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      if (message.type === "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3") {
        return filedReturnDownloadReady(message.payload.period as FiledReturnsMonth);
      }
      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        capturedTargets.push({
          actionId: message.payload.actionId,
          period: message.payload.period as FiledReturnsMonth,
        });
        const captured = filedGstr3bCapturedDownload();
        if (captured.ok && "mainWorldCaptureRequest" in captured) {
          bindTestCaptureRequest(captured.mainWorldCaptureRequest, message.payload);
        }
        return captured;
      }
      return { ok: false, error: "Unexpected call." };
    });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2024-25",
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
        timings: { flowStepSettleMs: 0, resultRowNavigationSettleMs: 0 },
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
        totalPeriods: 12,
      },
    });
    if (response.ok && "flowSummary" in response && response.flowSummary) {
      expect(response.flowSummary.completedPeriods).toHaveLength(12);
    }
    expect(capturedTargets).toHaveLength(12);
    expect(new Set(capturedTargets.map((target) => target.actionId)).size).toBe(12);
    expect(browser.scripting.executeScript).toHaveBeenCalledTimes(12);
    expect(stagedZipEntryCount).toBe(12);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
        payload: expect.objectContaining({
          expectedEntryCount: 12,
          expectedEntries: FILED_RETURNS_MONTHS.map((period) => ({
            artifactType: "PDF",
            entryNames: [`${period.toLowerCase()}.pdf`],
          })),
        }),
      }),
    );
    expect(browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "gstr-3b-2024-25-full-year.zip",
        saveAs: false,
      }),
    );
    expect(observeBrowserDownloadById).toHaveBeenCalledTimes(1);
    const sentTypes = sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type);
    expect(sentTypes).toHaveLength(24);
    expect(
      sentTypes.filter((type) => type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3"),
    ).toHaveLength(12);
  });

  it("stages GSTR-1 full-year PDF and Excel artifacts for one final ZIP", async () => {
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      if (message.type === "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3") {
        const artifactType = message.payload.artifactType === "EXCEL" ? "EXCEL" : "PDF";
        return filedGstr1DownloadReady(message.payload.period as FiledReturnsMonth, artifactType);
      }
      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        const artifactType = message.payload.artifactType ?? "PDF";
        return {
          ok: true,
          mainWorldCaptureRequest: {
            actionId: message.payload.actionId,
            controlAttribute: "data-pack-gstr2b-capture-action",
            controlId: `control-gstr1-${artifactType.toLowerCase()}`,
            maxBytes: 36 * 1024 * 1024,
            signalPrefix: "filed-gstr1",
            targetBinding: testCaptureBindingFromTarget(message.payload),
            timeoutMs: 15_000,
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
    expect(browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        conflictAction: "uniquify",
        filename: "gstr-1-2026-27-full-year.zip",
        saveAs: false,
        url: "blob:chrome-extension://pack/full-year.zip",
      }),
    );
    const preExportLedgerCallIndex = vi
      .mocked(browser.storage.local.set)
      .mock.calls.findIndex(([value]) => {
        const ledger = (value as Record<string, unknown>)["full-year-ledger"];
        if (typeof ledger !== "object" || ledger === null) return false;
        const record = ledger as Record<string, unknown>;
        return (
          record.status === "blocked" &&
          Array.isArray(record.targets) &&
          record.targets.every(
            (target) =>
              typeof target === "object" &&
              target !== null &&
              (target as Record<string, unknown>).status === "downloaded",
          )
        );
      });
    expect(preExportLedgerCallIndex).toBeGreaterThanOrEqual(0);
    expect(
      vi.mocked(browser.storage.local.set).mock.invocationCallOrder[preExportLedgerCallIndex],
    ).toBeLessThan(vi.mocked(browser.downloads.download).mock.invocationCallOrder.at(-1) ?? 0);
    const stagedCaptureConfigs = vi
      .mocked(browser.scripting.executeScript)
      .mock.calls.map(([details]) => captureConfigFromScriptingDetails(details))
      .filter((config) => config?.controlId);
    expect(stagedCaptureConfigs).not.toHaveLength(0);
    for (const captureConfig of stagedCaptureConfigs) {
      expect(captureConfig).not.toHaveProperty("transferId");
      expect(captureConfig).not.toHaveProperty("transferChunkSize");
    }
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
        payload: expect.objectContaining({ zipPath: "april.pdf" }),
      }),
    );
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
        payload: expect.objectContaining({ zipPath: "april.xlsx" }),
      }),
    );
    expect(observeBrowserDownloadById).toHaveBeenCalledTimes(1);
  });

  it("completes an all-not-filed fiscal year without claiming a final ZIP", async () => {
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => ({
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "candidate-not-found",
        safeSignals: [
          "filed-return-positively-not-filed",
          `filed-return-result-period:${message.payload.period}`,
        ],
        safeMessage: "The selected period was not filed.",
      },
    }));

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
      flowSummary: { status: "complete", completedPeriods: ["April", "May"] },
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-complete",
          "full-fiscal-year-no-zip-artifacts",
        ]),
      },
    });
    const responseStep = response.ok && "flowStep" in response ? response.flowStep : null;
    expect(responseStep?.safeSignals).not.toContain("full-fiscal-year-zip-downloaded");
    expect(browser.downloads.download).not.toHaveBeenCalled();
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
            targetBinding: testCaptureBindingFromTarget(message.payload),
          },
          downloadTrigger: {
            connectorId: "gst",
            scopeId: "gst-gstr2b-private-v0",
            state: "clicked",
            safeSignals: [
              "gstr2b-download-clicked",
              "gstr2b-portal-blob-download-captured",
              "gstr2b-extension-download-requested",
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
    stagedZipEntryCount = 2;
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
        safeSignals: ["full-fiscal-year-opfs-staged", "full-fiscal-year-opfs-staged:PDF"],
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

  it("retains staged full-year files when ZIP creation fails transiently", async () => {
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
        safeSignals: ["full-fiscal-year-opfs-staged", "full-fiscal-year-opfs-staged:PDF"],
      })),
    };
    vi.mocked(browser.runtime.sendMessage).mockImplementationOnce(async (message: unknown) => {
      const requestId =
        typeof message === "object" &&
        message !== null &&
        "payload" in message &&
        typeof message.payload === "object" &&
        message.payload !== null &&
        "requestId" in message.payload
          ? message.payload.requestId
          : undefined;
      return { ok: false, requestId, errorCategory: "zip-failed" };
    });

    const response = await exportFullFiscalYearZip(stagedLedger, {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "downloaded",
      safeSignals: ["full-fiscal-year-complete"],
      safeMessage: "Complete.",
    });

    expect(response).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining([
        "full-fiscal-year-zip-export-failed",
        "full-fiscal-year-opfs-retained",
      ]),
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        canResume: true,
      },
    });
    expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER" }),
    );
  });

  it("does not start the final ZIP until its recovery checkpoint is persisted", async () => {
    stagedZipEntryCount = 2;
    const stagedLedger: FiledReturnsFullFiscalYearLedger = {
      ...createFullFiscalYearLedger({
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
        safeSignals: ["full-fiscal-year-opfs-staged", "full-fiscal-year-opfs-staged:PDF"],
      })),
    };
    const onBeforeDownloadStart = vi.fn().mockRejectedValue(new Error("checkpoint failed"));

    const response = await exportFullFiscalYearZip(
      stagedLedger,
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded",
        safeSignals: ["full-fiscal-year-complete"],
        safeMessage: "Complete.",
      },
      { onBeforeDownloadStart },
    );

    expect(onBeforeDownloadStart).toHaveBeenCalledOnce();
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining([
        "full-fiscal-year-zip-download-state-persist-failed",
        "full-fiscal-year-opfs-retained",
      ]),
    });
  });

  it("keeps a confirmed final ZIP blocked until retained staging cleanup succeeds", async () => {
    stagedZipEntryCount = 2;
    const stagedLedger: FiledReturnsFullFiscalYearLedger = {
      ...createFullFiscalYearLedger({
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
        safeSignals: ["full-fiscal-year-opfs-staged", "full-fiscal-year-opfs-staged:PDF"],
      })),
    };
    mockLocalStorageGet({ "full-year-ledger": stagedLedger });
    const defaultRuntimeHandler = vi.mocked(browser.runtime.sendMessage).getMockImplementation()!;
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER"
      ) {
        const requestId =
          "payload" in message &&
          typeof message.payload === "object" &&
          message.payload !== null &&
          "requestId" in message.payload
            ? message.payload.requestId
            : undefined;
        return { ok: false, requestId, errorCategory: "clear-failed" };
      }
      return (defaultRuntimeHandler as (value: unknown) => unknown)(message);
    });

    const response = await startFiledReturnsDownloadFlow(stagedLedger.scope, {
      getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
      sendMessageToTabWithInjection:
        vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>(),
      storageKeys: {
        completion: "completion",
        fullFiscalYearLedger: "full-year-ledger",
        observation: "observation",
      },
      now: () => new Date("2026-06-24T00:00:00.000Z"),
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-zip-downloaded",
          "full-fiscal-year-zip-cleanup-pending",
          "full-fiscal-year-opfs-clear-failed",
          "full-fiscal-year-opfs-retained",
        ]),
      },
      flowSummary: { status: "blocked" },
    });
    const cleanupStep = response.ok && "flowStep" in response ? response.flowStep : null;
    expect(cleanupStep?.safeSignals).not.toContain("full-fiscal-year-final-zip-retry");
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        status: "blocked",
        zipPhase: "downloaded-cleanup-pending",
      }),
    });
    expect(browser.storage.local.set).not.toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({ status: "complete" }),
    });
  });

  it("finishes retained ZIP cleanup without reopening a GST Portal tab", async () => {
    const cleanupPendingLedger: FiledReturnsFullFiscalYearLedger = {
      ...createFullFiscalYearLedger({
        status: "blocked",
        targets: [
          { period: "April", status: "downloaded" },
          { period: "May", status: "downloaded" },
        ],
      }),
      zipPhase: "downloaded-cleanup-pending",
    };
    mockLocalStorageGet({ "full-year-ledger": cleanupPendingLedger });
    const getActiveGstTab = vi.fn(async () => null);

    const response = await startFiledReturnsDownloadFlow(cleanupPendingLedger.scope, {
      getActiveGstTab,
      sendMessageToTabWithInjection:
        vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>(),
      storageKeys: {
        completion: "completion",
        fullFiscalYearLedger: "full-year-ledger",
        observation: "observation",
      },
      now: () => new Date("2026-06-24T00:01:00.000Z"),
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-complete",
          "full-fiscal-year-opfs-cleared",
        ]),
      },
      flowSummary: { status: "complete" },
    });
    expect(getActiveGstTab).not.toHaveBeenCalled();
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.not.objectContaining({
        zipPhase: "downloaded-cleanup-pending",
      }),
    });
  });

  it("retries a durably recorded final ZIP handoff without repeating portal targets", async () => {
    stagedZipEntryCount = 2;
    const downloadStartedLedger: FiledReturnsFullFiscalYearLedger = {
      ...createFullFiscalYearLedger({
        status: "blocked",
        targets: [
          { period: "April", status: "downloaded" },
          { period: "May", status: "downloaded" },
        ],
      }),
      zipPhase: "download-started",
      targets: createFullFiscalYearLedger({
        targets: [
          { period: "April", status: "downloaded" },
          { period: "May", status: "downloaded" },
        ],
      }).targets.map((target) => ({
        ...target,
        safeSignals: ["full-fiscal-year-opfs-staged", "full-fiscal-year-opfs-staged:PDF"],
      })),
    };
    mockLocalStorageGet({ "full-year-ledger": downloadStartedLedger });
    const getActiveGstTab = vi.fn(async () => null);
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await startFiledReturnsDownloadFlow(downloadStartedLedger.scope, {
      getActiveGstTab,
      sendMessageToTabWithInjection,
      storageKeys: {
        completion: "completion",
        fullFiscalYearLedger: "full-year-ledger",
        observation: "observation",
      },
      now: () => new Date("2026-06-24T00:01:00.000Z"),
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining(["full-fiscal-year-complete"]),
      },
      flowSummary: { status: "complete" },
    });
    expect(getActiveGstTab).not.toHaveBeenCalled();
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
    expect(browser.downloads.download).toHaveBeenCalledOnce();
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        status: "blocked",
        zipPhase: "export-retry-pending",
      }),
    });
  });

  it.each(["complete", "in_progress"] as const)(
    "reconciles a persisted %s final ZIP by exact ID without starting another download",
    async (downloadState) => {
      const ledger = createStagedFinalZipLedger("download-observing", {
        requestedAt: "2026-06-24T00:00:30.000Z",
        downloadId: 91,
      });
      mockLocalStorageGet({ "full-year-ledger": ledger });
      mockDownloadSearch([
        {
          id: 91,
          state: downloadState,
          danger: "safe",
          fileSize: downloadState === "complete" ? 4096 : 0,
          filename: "Pack-GSTR3B-2026-27.zip",
          mime: "application/zip",
          startTime: "2026-06-24T00:00:31.000Z",
        },
      ]);
      vi.mocked(observeBrowserDownloadById).mockResolvedValueOnce({
        state: "completed",
        safeSignals: ["browser-download-completed", "browser-download-non-empty"],
        safeMessage: "Completed.",
        safeEvidence: {
          byteCountClass: "non-empty",
          downloadId: 91,
          mimeClass: "other",
          urlClass: "blob",
        },
      });

      const response = await startFiledReturnsDownloadFlow(ledger.scope, fullYearRunnerDeps());

      expect(response).toMatchObject({
        ok: true,
        flowStep: {
          state: "downloaded",
          safeSignals: expect.arrayContaining([
            "full-fiscal-year-zip-downloaded",
            "full-fiscal-year-opfs-cleared",
          ]),
        },
        flowSummary: { status: "complete" },
      });
      expect(browser.downloads.search).toHaveBeenCalledWith({ id: 91 });
      expect(observeBrowserDownloadById).toHaveBeenCalledWith(
        browser.downloads,
        91,
        expect.objectContaining({ trustedDownloadIds: new Set([91]) }),
        45_000,
      );
      expect(browser.downloads.download).not.toHaveBeenCalled();
    },
  );

  it("moves missing exact-ID ZIP staging to an intent-only manual-review checkpoint", async () => {
    const ledger = createStagedFinalZipLedger("download-observing", {
      requestedAt: "2026-06-24T00:00:30.000Z",
      downloadId: 92,
    });
    mockLocalStorageGet({ "full-year-ledger": ledger });
    mockDownloadSearch([]);

    const response = await startFiledReturnsDownloadFlow(ledger.scope, fullYearRunnerDeps());

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "download-unconfirmed",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-zip-download-id-not-found",
          "full-fiscal-year-final-zip-manual-review",
          "full-fiscal-year-opfs-retained",
        ]),
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(observeBrowserDownloadById).not.toHaveBeenCalled();
    expect(browser.storage.local.set).toHaveBeenLastCalledWith({
      "full-year-ledger": expect.objectContaining({
        zipPhase: "download-intent-persisted",
        zipDownloadAttempt: { requestedAt: "2026-06-24T00:00:30.000Z" },
      }),
    });
  });

  it.each([
    ["interrupted", "browser-download-interrupted"],
    ["zero-byte", "browser-download-zero-bytes"],
    ["unsafe", "browser-download-danger-rejected"],
  ] as const)(
    "fails closed for a terminal %s saved final ZIP and permits only a later explicit retry",
    async (failureKind, expectedSignal) => {
      const ledger = createStagedFinalZipLedger("download-observing", {
        requestedAt: "2026-06-24T00:00:30.000Z",
        downloadId: 93,
      });
      mockLocalStorageGet({ "full-year-ledger": ledger });
      mockDownloadSearch([
        {
          id: 93,
          state: failureKind === "interrupted" ? "interrupted" : "complete",
          danger: failureKind === "unsafe" ? "dangerous" : "safe",
          fileSize: failureKind === "zero-byte" ? 0 : 4096,
          filename: "Pack-GSTR3B-2026-27.zip",
          mime: "application/zip",
          startTime: "2026-06-24T00:00:31.000Z",
        },
      ]);
      vi.mocked(observeBrowserDownloadById).mockResolvedValueOnce({
        state: "failed",
        safeSignals: ["browser-download-created", expectedSignal],
        safeMessage: "Terminal failure.",
        userAction: {
          type: "RETRY_PORTAL_GENERATION",
          message: "Retry explicitly.",
          canResume: true,
        },
      });

      const response = await startFiledReturnsDownloadFlow(ledger.scope, fullYearRunnerDeps());

      expect(response).toMatchObject({
        ok: true,
        flowStep: {
          state: "blocked",
          safeSignals: expect.arrayContaining([expectedSignal, "full-fiscal-year-final-zip-retry"]),
        },
      });
      expect(browser.downloads.download).not.toHaveBeenCalled();
      const retryLedger = vi
        .mocked(browser.storage.local.set)
        .mock.calls.map(([value]) => (value as Record<string, unknown>)["full-year-ledger"])
        .find(
          (value) =>
            typeof value === "object" &&
            value !== null &&
            (value as Record<string, unknown>).zipPhase === "export-retry-pending",
        );
      expect(retryLedger).toBeDefined();
      expect(retryLedger).not.toHaveProperty("zipDownloadAttempt");
    },
  );

  it("keeps an intent-only checkpoint when the post-download ID persistence fails", async () => {
    stagedZipEntryCount = 2;
    const ledger = createStagedFinalZipLedger("export-pending");
    mockLocalStorageGet({ "full-year-ledger": ledger });
    vi.mocked(browser.storage.local.set).mockImplementation(async (value) => {
      const savedLedger = (value as Record<string, unknown>)["full-year-ledger"];
      if (
        typeof savedLedger === "object" &&
        savedLedger !== null &&
        (savedLedger as Record<string, unknown>).zipPhase === "download-observing"
      ) {
        throw new Error("ID checkpoint failed");
      }
    });

    const response = await startFiledReturnsDownloadFlow(ledger.scope, fullYearRunnerDeps());

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "download-unconfirmed",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-zip-download-id-persist-failed",
          "full-fiscal-year-final-zip-manual-review",
        ]),
      },
    });
    expect(browser.downloads.download).toHaveBeenCalledOnce();
    expect(observeBrowserDownloadById).not.toHaveBeenCalled();
    expect(browser.storage.local.set).toHaveBeenLastCalledWith({
      "full-year-ledger": expect.objectContaining({
        zipPhase: "download-intent-persisted",
        zipDownloadAttempt: expect.objectContaining({ requestedAt: expect.any(String) }),
      }),
    });
    const latestLedger = vi.mocked(browser.storage.local.set).mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(
      (latestLedger["full-year-ledger"] as FiledReturnsFullFiscalYearLedger).zipDownloadAttempt,
    ).not.toHaveProperty("downloadId");
  });

  it("blocks full-year ZIP export when only some completed target artifacts were staged", async () => {
    const now = "2026-06-24T00:00:00.000Z";
    const ledger: FiledReturnsFullFiscalYearLedger = {
      schemaVersion: "1.0",
      planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
      eligibleThrough: "May",
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
        safeSignals:
          period === "April"
            ? [
                "filed-gstr2b-download-clicked",
                "full-fiscal-year-opfs-staged",
                "full-fiscal-year-opfs-staged:PDF",
                "full-fiscal-year-opfs-staged:EXCEL",
              ]
            : ["filed-gstr2b-download-clicked"],
        safeMessage: `${period} downloaded.`,
        completedAt: now,
        updatedAt: now,
      })),
    };

    const response = await exportFullFiscalYearZip(ledger, {
      connectorId: "gst",
      scopeId: "gst-gstr2b-private-v0",
      state: "downloaded",
      safeSignals: ["full-fiscal-year-complete"],
      safeMessage: "Complete.",
    });

    expect(response).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining([
        "full-fiscal-year-complete",
        "full-fiscal-year-zip-artifact-staging-incomplete",
        "full-fiscal-year-zip-missing-artifact-count:2",
        "full-fiscal-year-opfs-retained",
      ]),
      safeMessage:
        "Pack did not stage every required period file, so it did not export an incomplete fiscal-year zip.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        canResume: true,
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
  });

  it("rejects a full-year ZIP whose entry count is smaller than the staged target plan", async () => {
    stagedZipEntryCount = 1;
    const ledger: FiledReturnsFullFiscalYearLedger = {
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
        safeSignals: ["full-fiscal-year-opfs-staged", "full-fiscal-year-opfs-staged:PDF"],
      })),
    };

    const response = await exportFullFiscalYearZip(ledger, {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "downloaded",
      safeSignals: ["full-fiscal-year-complete"],
      safeMessage: "Complete.",
    });

    expect(response).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining([
        "full-fiscal-year-zip-entry-count-mismatch",
        "full-fiscal-year-zip-expected-entry-count:2",
        "full-fiscal-year-zip-actual-entry-count:1",
        "full-fiscal-year-opfs-retained",
      ]),
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
  });

  it("does not claim or start a ZIP when every full-year target has no artifact", async () => {
    const ledger: FiledReturnsFullFiscalYearLedger = {
      ...createFullFiscalYearLedger({
        status: "blocked",
        targets: [
          { period: "April", status: "not-filed" },
          { period: "May", status: "not-filed" },
        ],
      }),
      zipPhase: "export-pending",
    };

    const response = await exportFullFiscalYearZip(ledger, {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "downloaded",
      safeSignals: ["full-fiscal-year-complete"],
      safeMessage: "Complete.",
    });

    expect(response).toMatchObject({
      state: "downloaded",
      safeSignals: expect.arrayContaining(["full-fiscal-year-no-zip-artifacts"]),
    });
    expect(response.safeSignals).not.toContain("full-fiscal-year-zip-downloaded");
    expect(browser.downloads.download).not.toHaveBeenCalled();
  });

  it("clears single-period staging when the browser rejects the final ZIP start", async () => {
    stagedZipEntryCount = 2;
    vi.mocked(browser.downloads.download).mockRejectedValueOnce(new Error("save rejected"));
    const options = singlePeriodZipCheckpointOptions();

    const response = await exportSinglePeriodFiledReturnsZip({
      completeStep: {
        connectorId: "gst",
        scopeId: "gst-gstr2b-private-v0",
        state: "downloaded",
        safeSignals: ["filed-return-artifact-downloaded:PDF"],
        safeMessage: "Artifacts staged.",
      },
      entryPlan: combinedMayZipEntryPlan(),
      ledgerId: "single-period-ledger",
      options,
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      },
    });

    expect(response).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining([
        "single-period-zip-download-start-rejected",
        "single-period-opfs-cleared",
        "single-period-cleanup-checkpoints-cleared",
      ]),
    });
    expect(response.safeSignals).not.toContain("single-period-opfs-retained");
    expect(options.onAfterStagingCleared).toHaveBeenCalledOnce();
    expect(options.onAfterStagingCleared).toHaveBeenCalledWith("not-downloaded");
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
        payload: expect.objectContaining({ ledgerId: "single-period-ledger" }),
      }),
    );
  });

  it("blocks single-period completion when temporary staging cleanup fails", async () => {
    stagedZipEntryCount = 2;
    const options = singlePeriodZipCheckpointOptions();
    const defaultRuntimeHandler = vi.mocked(browser.runtime.sendMessage).getMockImplementation()!;
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER"
      ) {
        const requestId =
          "payload" in message &&
          typeof message.payload === "object" &&
          message.payload !== null &&
          "requestId" in message.payload
            ? message.payload.requestId
            : undefined;
        return { ok: false, requestId, errorCategory: "clear-failed" };
      }
      return (defaultRuntimeHandler as (value: unknown) => unknown)(message);
    });

    const response = await exportSinglePeriodFiledReturnsZip({
      completeStep: {
        connectorId: "gst",
        scopeId: "gst-gstr2b-private-v0",
        state: "downloaded",
        safeSignals: ["filed-return-artifact-downloaded:PDF"],
        safeMessage: "Artifacts staged.",
      },
      entryPlan: combinedMayZipEntryPlan(),
      ledgerId: "single-period-ledger",
      options,
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      },
    });

    expect(response).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining([
        "single-period-zip-downloaded",
        "single-period-opfs-clear-failed",
        "single-period-opfs-retained",
      ]),
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        canResume: true,
      },
    });
    expect(options.onAfterStagingCleared).not.toHaveBeenCalled();
  });

  it("blocks aggregate success when durable cleanup cannot be verified after OPFS clears", async () => {
    stagedZipEntryCount = 2;
    const options = singlePeriodZipCheckpointOptions();
    options.onAfterStagingCleared.mockRejectedValueOnce(
      new Error("synthetic cleanup checkpoint failure"),
    );

    const response = await exportSinglePeriodFiledReturnsZip({
      completeStep: {
        connectorId: "gst",
        scopeId: "gst-gstr2b-private-v0",
        state: "downloaded",
        safeSignals: ["filed-return-artifact-downloaded:PDF"],
        safeMessage: "Artifacts staged.",
      },
      entryPlan: combinedMayZipEntryPlan(),
      ledgerId: "single-period:cleanup-record",
      options,
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      },
    });

    expect(response).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining([
        "single-period-zip-downloaded",
        "single-period-opfs-cleared",
        "single-period-cleanup-checkpoint-failed",
      ]),
    });
    expect(response.safeSignals).not.toContain("single-period-opfs-retained");
    expect(response.safeSignals).not.toContain("single-period-cleanup-checkpoints-cleared");
  });

  it("exports the exact single-period PDF set when GSTR-1 Excel is explicitly unavailable", async () => {
    stagedZipEntryCount = 1;

    const response = await exportSinglePeriodFiledReturnsZip({
      completeStep: {
        connectorId: "gst",
        scopeId: "gst-gstr1-private-v0",
        state: "downloaded",
        safeSignals: [
          "filed-return-artifact-downloaded:PDF",
          "filed-return-artifact-unavailable:EXCEL",
        ],
        safeMessage: "PDF staged; Excel unavailable.",
      },
      entryPlan: {
        artifactTypes: ["PDF"],
        unavailableArtifactTypes: ["EXCEL"],
      },
      ledgerId: "single-period-gstr1-no-excel",
      options: singlePeriodZipCheckpointOptions(),
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-1",
      },
    });

    expect(response).toMatchObject({
      state: "downloaded",
      safeSignals: expect.arrayContaining([
        "single-period-zip-downloaded",
        "single-period-zip-entry-count:1",
      ]),
    });
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
        payload: expect.objectContaining({
          expectedEntryCount: 1,
          expectedEntries: [{ artifactType: "PDF", entryNames: ["may.pdf"] }],
        }),
      }),
    );
  });

  it("exports a combined GSTR-1 ZIP when PDF is staged and optional Excel is unavailable", async () => {
    stagedZipEntryCount = 1;
    const now = "2026-07-14T00:00:00.000Z";
    const ledger: FiledReturnsFullFiscalYearLedger = {
      schemaVersion: "1.0",
      planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
      eligibleThrough: "April",
      ledgerId: "gstr1-ledger-with-unavailable-excel",
      status: "blocked",
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-1",
      },
      createdAt: now,
      updatedAt: now,
      targets: [
        {
          targetId: "GSTR-1:2026-27:April:PDF_AND_EXCEL",
          financialYear: "2026-27",
          period: "April",
          returnType: "GSTR-1",
          artifactType: "PDF_AND_EXCEL",
          status: "downloaded",
          attempts: 1,
          safeSignals: [
            "filed-return-artifact-downloaded:PDF",
            "full-fiscal-year-opfs-staged:PDF",
            "filed-return-artifact-unavailable:EXCEL",
          ],
          safeMessage: "PDF staged; Excel unavailable.",
          completedAt: now,
          updatedAt: now,
        },
      ],
    };

    const response = await exportFullFiscalYearZip(ledger, {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "downloaded",
      safeSignals: ["full-fiscal-year-complete"],
      safeMessage: "Complete.",
    });

    expect(response).toMatchObject({
      state: "downloaded",
      safeSignals: expect.arrayContaining([
        "full-fiscal-year-zip-downloaded",
        "full-fiscal-year-zip-entry-count:1",
      ]),
    });
    expect(browser.downloads.download).toHaveBeenCalledTimes(1);
  });

  it("keeps portal-click-only full-year artifacts retryable until their bytes are staged", () => {
    const blocked = requireFullFiscalYearArtifactsStaged(
      {
        artifactType: "PDF",
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded",
        safeSignals: [
          "filed-gstr3b-download-clicked",
          "browser-download-completed",
          "filed-return-artifact-downloaded:PDF",
        ],
        safeMessage: "Portal download completed.",
      },
    );

    expect(blocked).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining([
        "full-fiscal-year-artifact-staging-incomplete",
        "full-fiscal-year-artifact-not-staged:PDF",
      ]),
      userAction: { type: "RETRY_PORTAL_GENERATION", canResume: true },
    });
  });

  it("drops stale OPFS staging evidence before a full-year restaging retry", () => {
    const baseLedger = createFullFiscalYearLedger({
      currentPeriod: "April",
      targets: [{ period: "April", status: "downloaded" }],
    });
    const ledger = {
      ...baseLedger,
      targets: baseLedger.targets.map((target) => ({
        ...target,
        safeSignals: ["filed-return-artifact-downloaded:PDF", "full-fiscal-year-opfs-staged:PDF"],
      })),
    };

    const restaging = markFullFiscalYearRestagingRequired(
      ledger,
      new Date("2026-07-14T00:01:00.000Z"),
    );

    expect(restaging.targets[0]?.safeSignals).toContain("filed-return-artifact-downloaded:PDF");
    expect(restaging.targets[0]?.safeSignals).toContain("full-fiscal-year-restaging-required");
    expect(restaging.targets[0]?.safeSignals).not.toContain("full-fiscal-year-opfs-staged:PDF");
  });

  it("retries the combined artifact that lacks full-year staging evidence", () => {
    expect(
      scopeForFullFiscalYearTarget({
        targetId: "GSTR-1:2025-26:March:PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-1",
        artifactType: "PDF_AND_EXCEL",
        status: "blocked",
        attempts: 1,
        safeSignals: [
          "filed-return-artifact-downloaded:PDF",
          "full-fiscal-year-opfs-staged:PDF",
          "filed-return-artifact-downloaded:EXCEL",
        ],
        safeMessage: "Excel was downloaded but not staged.",
        updatedAt: "2026-07-14T00:00:00.000Z",
      }),
    ).toMatchObject({ artifactType: "EXCEL", period: "March", returnType: "GSTR-1" });
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
            targetBinding: testCaptureBindingFromTarget(message.payload),
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
    const stagingReservationIndex = vi
      .mocked(browser.storage.local.set)
      .mock.calls.findIndex(
        ([values]) =>
          typeof values === "object" && values !== null && "pack:single-period-staging" in values,
      );
    const firstArtifactStageIndex = vi
      .mocked(browser.runtime.sendMessage)
      .mock.calls.findIndex(
        ([message]) =>
          typeof message === "object" &&
          message !== null &&
          (message as { type?: unknown }).type === "PACK_OFFSCREEN_STAGE_FILED_RETURN",
      );
    expect(stagingReservationIndex).toBeGreaterThanOrEqual(0);
    expect(firstArtifactStageIndex).toBeGreaterThanOrEqual(0);
    const stagingReservationOrder = vi.mocked(browser.storage.local.set).mock.invocationCallOrder[
      stagingReservationIndex
    ];
    const firstArtifactStageOrder = vi.mocked(browser.runtime.sendMessage).mock.invocationCallOrder[
      firstArtifactStageIndex
    ];
    expect(stagingReservationOrder).toBeDefined();
    expect(firstArtifactStageOrder).toBeDefined();
    expect(stagingReservationOrder!).toBeLessThan(firstArtifactStageOrder!);
    expect(observeBrowserDownloadById).toHaveBeenCalledTimes(1);
    expect(localStorageValues["pack:single-period-staging"]).toBeUndefined();
    expect(localStorageValues["pack:filed-returns-target-review"]).toBeUndefined();
    const durableCompletionIndex = vi
      .mocked(browser.storage.session.set)
      .mock.calls.findIndex(([values]) => {
        const completion = (values as Record<string, unknown>)["completion"];
        return (
          typeof completion === "object" &&
          completion !== null &&
          "status" in completion &&
          completion.status === "complete"
        );
      });
    const bundleClearIndex = vi
      .mocked(browser.storage.local.remove)
      .mock.calls.findIndex(([keys]) =>
        (Array.isArray(keys) ? keys : [keys]).some((key) => key === "pack:single-period-staging"),
      );
    const targetReviewClearIndex = vi
      .mocked(browser.storage.local.remove)
      .mock.calls.findIndex(([keys]) =>
        (Array.isArray(keys) ? keys : [keys]).some(
          (key) => key === "pack:filed-returns-target-review",
        ),
      );
    expect(durableCompletionIndex).toBeGreaterThanOrEqual(0);
    expect(bundleClearIndex).toBeGreaterThanOrEqual(0);
    expect(targetReviewClearIndex).toBeGreaterThanOrEqual(0);
    const durableCompletionOrder = vi.mocked(browser.storage.session.set).mock.invocationCallOrder[
      durableCompletionIndex
    ];
    const bundleClearOrder = vi.mocked(browser.storage.local.remove).mock.invocationCallOrder[
      bundleClearIndex
    ];
    const targetReviewClearOrder = vi.mocked(browser.storage.local.remove).mock.invocationCallOrder[
      targetReviewClearIndex
    ];
    expect(durableCompletionOrder).toBeDefined();
    expect(bundleClearOrder).toBeDefined();
    expect(targetReviewClearOrder).toBeDefined();
    expect(durableCompletionOrder!).toBeLessThan(bundleClearOrder!);
    expect(durableCompletionOrder!).toBeLessThan(targetReviewClearOrder!);
  });

  it("clears both durable checkpoints when a selected ZIP start is rejected", async () => {
    vi.mocked(browser.downloads.download).mockRejectedValueOnce(new Error("save rejected"));
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      if (message.type === "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3") {
        return gstr2bDownloadReady("May");
      }
      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        const response = filedGstr2bCapturedDownload(
          "May",
          "2026-27",
          message.payload.artifactType === "JSON" ? "PDF" : (message.payload.artifactType ?? "PDF"),
        );
        if (response.ok && "mainWorldCaptureRequest" in response) {
          bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
        }
        return response;
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
        now: () => new Date("2026-07-24T00:00:00.000Z"),
        timings: { flowStepSettleMs: 0, resultRowNavigationSettleMs: 0 },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "single-period-zip-download-start-rejected",
          "single-period-opfs-cleared",
          "single-period-cleanup-checkpoints-cleared",
        ]),
      },
    });
    expect(response).toHaveProperty("flowSummary.status", "blocked");
    expect(localStorageValues["pack:single-period-staging"]).toBeUndefined();
    expect(localStorageValues["pack:filed-returns-target-review"]).toBeUndefined();
  });

  it("persists a target review for an interrupted bundle and blocks restart portal actions", async () => {
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
            safeSignals: ["gstr2b-summary-route", "filed-return-download-ready"],
            safeMessage: "Ready.",
          },
        } as PackMessageResponse;
      }

      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        return {
          ok: true,
          downloadTrigger: {
            connectorId: "gst",
            scopeId: "gst-gstr2b-private-v0",
            state: "blocked",
            safeSignals: ["portal-system-error"],
            safeMessage: "The portal blocked the first selected artifact.",
          },
        } as PackMessageResponse;
      }

      return { ok: false, error: "Unexpected call." };
    });

    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2026-27",
      period: "May" as const,
      returnType: "GSTR-2B" as const,
    };
    const getActiveGstTab = vi.fn(async () => ACTIVE_GST_TAB);
    const deps: FiledReturnsFlowRunnerDeps = {
      getActiveGstTab,
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
    };

    const response = await startFiledReturnsDownloadFlow(scope, deps);

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining([
          "portal-system-error",
          "single-period-bundle-artifact-review-required",
          "single-period-bundle-running-ambiguous",
          "single-period-opfs-retained",
        ]),
      },
    });
    expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER" }),
    );
    expect(localStorageValues["pack:single-period-staging"]).toMatchObject({
      phase: "artifact-review",
      artifacts: [
        expect.objectContaining({ artifactType: "PDF", status: "running" }),
        expect.objectContaining({ artifactType: "EXCEL", status: "pending" }),
      ],
    });
    expect(localStorageValues["target-review"]).toMatchObject({
      scope,
      safeSignals: expect.arrayContaining([
        "single-period-bundle-artifact-review-required",
        "single-period-bundle-running-ambiguous",
      ]),
      singlePeriodBundleCheckpoint: {
        ledgerId: expect.stringMatching(/^single-period:/),
        revision: expect.any(Number),
      },
      status: "download-unconfirmed",
    });

    getActiveGstTab.mockClear();
    sendMessageToTabWithInjection.mockClear();
    vi.mocked(browser.downloads.download).mockClear();
    vi.mocked(browser.scripting.executeScript).mockClear();

    const restartedResponse = await startFiledReturnsDownloadFlow(scope, deps);

    expect(restartedResponse).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["filed-returns-target-review-required"]),
      },
    });
    expect(getActiveGstTab).not.toHaveBeenCalled();
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("preflights an interrupted bundle before tab access after the first review write fails", async () => {
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
            safeSignals: ["gstr2b-summary-route", "filed-return-download-ready"],
            safeMessage: "Ready.",
          },
        } as PackMessageResponse;
      }
      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        return {
          ok: true,
          downloadTrigger: {
            connectorId: "gst",
            scopeId: "gst-gstr2b-private-v0",
            state: "blocked",
            safeSignals: ["portal-system-error"],
            safeMessage: "The portal blocked the selected artifact.",
          },
        } as PackMessageResponse;
      }
      return { ok: false, error: "Unexpected call." };
    });
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2026-27",
      period: "May" as const,
      returnType: "GSTR-2B" as const,
    };
    const getActiveGstTab = vi.fn(async () => ACTIVE_GST_TAB);
    const deps: FiledReturnsFlowRunnerDeps = {
      getActiveGstTab,
      sendMessageToTabWithInjection,
      storageKeys: {
        completion: "completion",
        fullFiscalYearLedger: "full-year-ledger",
        observation: "observation",
        targetReview: "target-review",
      },
      timings: { flowStepSettleMs: 0, resultRowNavigationSettleMs: 0 },
    };
    let rejectFirstReviewWrite = true;
    vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
      if (rejectFirstReviewWrite && Object.hasOwn(values, "target-review")) {
        rejectFirstReviewWrite = false;
        throw new Error("Synthetic target-review write failure.");
      }
      Object.assign(localStorageValues, values);
    });

    const firstResponse = await startFiledReturnsDownloadFlow(scope, deps);

    expect(firstResponse).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "single-period-bundle-state-persist-failed",
          "single-period-opfs-retained",
        ]),
      },
    });
    expect(localStorageValues["target-review"]).toBeUndefined();
    expect(localStorageValues["pack:single-period-staging"]).toMatchObject({
      phase: "artifact-review",
      artifacts: [
        expect.objectContaining({ artifactType: "PDF", status: "running" }),
        expect.objectContaining({ artifactType: "EXCEL", status: "pending" }),
      ],
    });

    getActiveGstTab.mockClear();
    sendMessageToTabWithInjection.mockClear();
    vi.mocked(browser.scripting.executeScript).mockClear();
    vi.mocked(browser.downloads.download).mockClear();

    const restartedResponse = await startFiledReturnsDownloadFlow(scope, deps);

    expect(restartedResponse).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining([
          "filed-returns-target-review-required",
          "single-period-bundle-artifact-review-required",
        ]),
      },
    });
    expect(localStorageValues["target-review"]).toMatchObject({
      singlePeriodBundleCheckpoint: {
        ledgerId: expect.stringMatching(/^single-period:/),
        revision: expect.any(Number),
      },
    });
    expect(getActiveGstTab).not.toHaveBeenCalled();
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
    expect(browser.downloads.download).not.toHaveBeenCalled();
  });

  it("returns the retained combined recovery before a PDF-only restart reaches the portal", async () => {
    const harness = await createFailedInterruptedBundleReview();
    clearPortalSideEffectMocks(harness);

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF",
        financialYear: harness.scope.financialYear,
        period: harness.scope.period,
        returnType: harness.scope.returnType,
      },
      harness.deps,
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        safeSignals: expect.arrayContaining(["filed-returns-target-review-required"]),
      },
      flowSummary: {
        scope: harness.scope,
        status: "blocked",
      },
    });
    expectNoPortalSideEffects(harness);
  });

  it("returns the retained combined recovery before a staged full-year target reaches the portal", async () => {
    const harness = await createFailedInterruptedBundleReview();
    clearPortalSideEffectMocks(harness);

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: harness.scope.financialYear,
        period: "June",
        returnType: harness.scope.returnType,
      },
      {
        ...harness.deps,
        stageCapturedDownloads: {
          bundleKind: "full-fiscal-year",
          ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        safeSignals: expect.arrayContaining(["filed-returns-target-review-required"]),
      },
      flowSummary: {
        scope: harness.scope,
        status: "blocked",
      },
    });
    expectNoPortalSideEffects(harness);
  });

  it("keeps staged single-period capture timeouts in explicit target review", async () => {
    vi.mocked(browser.scripting.executeScript).mockResolvedValueOnce([
      {
        result: {
          capturedDownloadRequest: null,
          safeFailureSignals: [
            "gstr2b-main-world-capture-armed",
            "gstr2b-main-world-capture-timeout",
          ],
        },
      },
    ] as never);
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
            safeSignals: ["gstr2b-summary-route", "filed-return-download-ready"],
            safeMessage: "Ready.",
          },
        } as PackMessageResponse;
      }
      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        return {
          ok: true,
          mainWorldCaptureRequest: {
            actionId: message.payload.actionId,
            controlAttribute: "data-pack-gstr2b-capture-action",
            controlId: "control-gstr2b-pdf",
            maxBytes: 36 * 1024 * 1024,
            signalPrefix: "gstr2b",
            targetBinding: testCaptureBindingFromTarget(message.payload),
          },
          downloadTrigger: {
            connectorId: "gst",
            scopeId: "gst-gstr2b-private-v0",
            state: "clicked",
            safeSignals: ["gstr2b-download-clicked"],
            safeMessage: "Capture armed.",
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
          targetReview: "target-review",
        },
        timings: { flowStepSettleMs: 0, resultRowNavigationSettleMs: 0 },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining([
          "gstr2b-main-world-capture-timeout",
          "single-period-bundle-artifact-review-required",
          "single-period-bundle-running-ambiguous",
          "single-period-opfs-retained",
        ]),
      },
    });
    expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER" }),
    );
    expect(localStorageValues["pack:single-period-staging"]).toMatchObject({
      phase: "artifact-review",
      artifacts: [
        expect.objectContaining({ artifactType: "PDF", status: "running" }),
        expect.objectContaining({ artifactType: "EXCEL", status: "pending" }),
      ],
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        "target-review": expect.objectContaining({
          scope: expect.objectContaining({ artifactType: "PDF_AND_EXCEL" }),
          status: "download-unconfirmed",
        }),
      }),
    );
  });

  it("continues a GSTR-1 full fiscal year when a PDF is downloaded but Excel is unavailable", async () => {
    const responses: PackMessageResponse[] = [
      filedGstr1DownloadReady("April", "PDF"),
      filedGstr1CapturedDownload("PDF"),
      filedGstr1DownloadReady("April", "EXCEL"),
      filedGstr1ExcelNoDetailsAvailable(),
      filedGstr1DownloadReady("May", "PDF"),
      filedGstr1CapturedDownload("PDF"),
      filedGstr1DownloadReady("May", "EXCEL"),
      filedGstr1CapturedDownload("EXCEL"),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false as const, error: "Unexpected call." };
      if (
        message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
        response.ok &&
        "mainWorldCaptureRequest" in response
      ) {
        bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
      }
      return response;
    });

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
    stagedZipEntryCount = 3;
    mockCompletedBrowserDownload("spreadsheet");
    const aprilPdfDiagnostic = positiveTestDownloadDiagnostic({
      actionSuffix: "apdf",
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-1",
    });
    const mayPdfDiagnostic = positiveTestDownloadDiagnostic({
      actionSuffix: "mpdf",
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-1",
    });
    const mayExcelDiagnostic = positiveTestDownloadDiagnostic({
      actionSuffix: "mxls",
      artifactType: "EXCEL",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-1",
    });
    const ledger: FiledReturnsFullFiscalYearLedger = {
      schemaVersion: "1.0",
      ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
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
          ...canonicalDurableTargetStatus(
            {
              artifactType: "PDF_AND_EXCEL",
              financialYear: "2026-27",
              period: "April",
              returnType: "GSTR-1",
            },
            "download-unconfirmed",
            [
              "filed-return-artifact-downloaded:PDF",
              "full-fiscal-year-opfs-staged:PDF",
              "filed-return-artifact-unconfirmed:EXCEL",
              "browser-download-correlation-rejected",
            ],
          ),
          downloadDiagnostic: aprilPdfDiagnostic,
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
          ...canonicalDurableTargetStatus(
            {
              artifactType: "PDF_AND_EXCEL",
              financialYear: "2026-27",
              period: "May",
              returnType: "GSTR-1",
            },
            "downloaded",
            [
              "filed-return-artifact-downloaded:PDF",
              "filed-return-artifact-downloaded:EXCEL",
              "full-fiscal-year-opfs-staged:PDF",
              "full-fiscal-year-opfs-staged:EXCEL",
            ],
          ),
          downloadDiagnostic: mayExcelDiagnostic,
          downloadDiagnostics: [mayPdfDiagnostic, mayExcelDiagnostic],
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
      filedGstr1CapturedDownload("EXCEL"),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false as const, error: "Unexpected call." };
      if (
        message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
        response.ok &&
        "mainWorldCaptureRequest" in response
      ) {
        bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
      }
      return response;
    });

    const response = await retryFullFiscalYearTargetDownloadFlow(
      {
        ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
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

  it("does not re-click GSTR-3B after main-world capture times out", async () => {
    vi.mocked(browser.scripting.executeScript).mockResolvedValueOnce([
      {
        result: {
          capturedDownloadRequest: null,
          safeFailureSignals: [
            "filed-gstr3b-main-world-capture-armed",
            "filed-gstr3b-main-world-capture-timeout",
          ],
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
          targetBinding: testCaptureBinding("GSTR-3B", "2026-27", "May", "PDF"),
        },
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-download-clicked", "filed-gstr3b-download-clicked"],
          safeMessage: "Capture armed.",
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
        bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
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
        state: "blocked",
        safeSignals: expect.arrayContaining(["filed-gstr3b-main-world-capture-timeout"]),
      },
      flowSummary: {
        flowStep: {
          safeSignals: expect.arrayContaining(["filed-returns-target-review-required"]),
        },
        status: "blocked",
      },
    });
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
  });

  it("does not open a native child save when full-year GSTR-3B capture fails", async () => {
    vi.mocked(browser.scripting.executeScript).mockResolvedValueOnce([
      {
        result: {
          capturedDownloadRequest: null,
          safeFailureSignals: [
            "filed-gstr3b-main-world-capture-armed",
            "filed-gstr3b-main-world-capture-timeout",
          ],
        },
      },
    ] as never);
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("April"),
      filedGstr3bCapturedDownload(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false as const, error: "Unexpected call." };
      if (
        message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
        response.ok &&
        "mainWorldCaptureRequest" in response
      ) {
        bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
      }
      return response;
    });

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
        timings: { flowStepSettleMs: 0, resultRowNavigationSettleMs: 0 },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining(["filed-gstr3b-main-world-capture-timeout"]),
      },
      flowSummary: { currentPeriod: "April", status: "blocked" },
    });
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
    expect(browser.downloads.download).not.toHaveBeenCalled();
  });

  it("saves captured May GSTR-3B portal PDF blobs through the extension downloads API", async () => {
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
        mainWorldCaptureRequest: {
          actionId: "action-captured",
          controlAttribute: "data-pack-gstr2b-capture-action",
          controlId: "control-gstr3b-pdf",
          maxBytes: 36 * 1024 * 1024,
          signalPrefix: "filed-gstr3b",
          targetBinding: testCaptureBinding("GSTR-3B", "2026-27", "May", "PDF"),
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
        bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
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
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
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
          targetBinding: testCaptureBinding("GSTR-1", "2025-26", "March", "PDF"),
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
        bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
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
      }),
    );
  });

  it.each([
    ["capture timeout", "filed-gstr1-main-world-capture-timeout"],
    ["capture exception", "filed-gstr1-main-world-capture-exception"],
    ["capture result rejection", "filed-gstr1-main-world-capture-result-rejected"],
    ["captured payload rejection", "filed-gstr1-captured-download-data-url-rejected"],
  ] as const)(
    "keeps a GSTR-1 summary PDF target in review after %s without clicking again",
    async (failureKind, expectedSignal) => {
      if (failureKind === "capture timeout") {
        vi.mocked(browser.scripting.executeScript).mockResolvedValueOnce([
          {
            result: {
              capturedDownloadRequest: null,
              safeFailureSignals: ["filed-gstr1-main-world-capture-armed", expectedSignal],
            },
          },
        ] as never);
      } else if (failureKind === "capture exception") {
        vi.mocked(browser.scripting.executeScript).mockRejectedValueOnce(
          new Error("Synthetic main-world capture failure."),
        );
      } else if (failureKind === "capture result rejection") {
        vi.mocked(browser.scripting.executeScript).mockResolvedValueOnce([
          { result: { unexpected: true } },
        ] as never);
      } else {
        vi.mocked(browser.scripting.executeScript).mockImplementationOnce(async (details) => [
          {
            result: {
              capturedDownloadRequest: {
                actionId: actionIdFromScriptingDetails(details),
                dataUrl: dataUrl("text/plain", "not a summary pdf"),
                safeSignals: [
                  "filed-gstr1-portal-blob-captured",
                  "filed-gstr1-native-blob-click-suppressed",
                  "filed-gstr1-main-world-capture",
                ],
              },
              safeFailureSignals: [],
            },
          },
        ]);
      }

      const responses: PackMessageResponse[] = [
        filedGstr1DownloadReady("March", "PDF"),
        filedGstr1CapturedDownload("PDF"),
      ];
      const sendMessageToTabWithInjection = vi.fn<
        FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
      >(async (_tabId, message) => {
        const response = responses.shift() ?? { ok: false as const, error: "Unexpected call." };
        if (
          message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
          response.ok &&
          "mainWorldCaptureRequest" in response
        ) {
          bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
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

      expect(response).toMatchObject({
        ok: true,
        flowStep: {
          state: "blocked",
          safeSignals: expect.arrayContaining([expectedSignal]),
        },
        flowSummary: {
          status: "blocked",
          completedPeriods: [],
          currentPeriod: "March",
          totalPeriods: 1,
        },
      });
      if (response.ok && "flowStep" in response) {
        expect(response.flowStep.safeSignals).not.toContain("browser-download-completed");
      }
      expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
        "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
        "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
      ]);
      expect(browser.downloads.download).not.toHaveBeenCalled();
      expect(observeBrowserDownloadById).not.toHaveBeenCalled();
    },
  );

  it("retains staged single-period bytes and the exact ZIP ID when size stays unconfirmed", async () => {
    vi.mocked(observeBrowserDownloadById).mockResolvedValueOnce({
      state: "not-observed",
      safeSignals: ["browser-download-created", "browser-download-size-unknown"],
      safeMessage: "The browser completed the ZIP without stable size evidence.",
    });
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
            targetBinding: testCaptureBindingFromTarget(message.payload),
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
          "single-period-zip-download-unconfirmed",
          "single-period-opfs-retained",
          "browser-download-size-unknown",
        ]),
      },
      flowSummary: {
        currentPeriod: "April",
        status: "blocked",
        flowStep: {
          safeSignals: expect.arrayContaining([
            "filed-returns-target-review-required",
            "filed-returns-download-reconciliation-required",
          ]),
        },
      },
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "target-review": expect.objectContaining({
        downloadAttempt: expect.objectContaining({
          downloadId: 81,
          kind: "single-period-zip",
          phase: "download-observing",
        }),
        targetId: "GSTR-2B:2026-27:April:PDF_AND_EXCEL",
      }),
    });
    expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
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
          targetBinding: testCaptureBinding("GSTR-1", "2025-26", "March", "EXCEL"),
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
        bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
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

  it("classifies GSTR-1 Excel no-details after a failed capture without clicking again", async () => {
    vi.mocked(browser.scripting.executeScript).mockResolvedValueOnce([
      {
        result: {
          capturedDownloadRequest: null,
          safeFailureSignals: [
            "filed-gstr1-main-world-capture-armed",
            "filed-gstr1-main-world-capture-timeout",
          ],
        },
      },
    ] as never);
    const responses: PackMessageResponse[] = [
      filedGstr1DownloadReady("March", "EXCEL"),
      filedGstr1CapturedDownload("EXCEL"),
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "blocked",
          safeSignals: ["filed-gstr1-excel-no-details-available"],
          safeMessage: "No e-invoice details are available.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false as const, error: "Unexpected call." };
      if (
        message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
        response.ok &&
        "mainWorldCaptureRequest" in response
      ) {
        bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
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
        timings: { flowStepSettleMs: 0, resultRowNavigationSettleMs: 0 },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "filed-gstr1-main-world-capture-timeout",
          "filed-gstr1-excel-no-details-available",
        ]),
      },
    });
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
      "PACK_CONTENT_INSPECT_FILED_RETURN_POST_CLICK_V3",
    ]);
    expect(browser.downloads.download).not.toHaveBeenCalled();
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
            targetBinding: testCaptureBindingFromTarget(message.payload),
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
      }),
    );
    const observationContext = vi.mocked(observeBrowserDownloadById).mock.calls.at(-1)?.[2];
    expect(observationContext?.trustedDownloadIds?.has(81)).toBe(true);
    const captureConfig = captureConfigFromScriptingDetails(
      vi.mocked(browser.scripting.executeScript).mock.calls.at(-1)?.[0],
    );
    expect(captureConfig).not.toHaveProperty("transferId");
    expect(captureConfig).not.toHaveProperty("transferChunkSize");
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
  });

  it("blocks a captured GSTR-2B payload that does not match the requested artifact", async () => {
    vi.mocked(browser.scripting.executeScript).mockImplementationOnce(async (details) => [
      {
        result: {
          capturedDownloadRequest: {
            actionId: actionIdFromScriptingDetails(details),
            dataUrl: dataUrl("text/plain", "not a pdf"),
            safeSignals: [
              "gstr2b-portal-blob-captured",
              "gstr2b-native-blob-click-suppressed",
              "gstr2b-main-world-capture",
            ],
          },
          safeFailureSignals: [],
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
            targetBinding: testCaptureBindingFromTarget(message.payload),
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
        safeSignals: expect.arrayContaining(["filed-gstr2b-captured-download-data-url-rejected"]),
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
        },
      },
    });
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
    expect(browser.downloads.download).not.toHaveBeenCalled();
  });

  it("attributes rejected captured payloads to the target return type", async () => {
    const response = await startCapturedFiledReturnDownload({
      activePeriod: "May",
      armedAt: new Date("2026-06-24T10:00:00.000Z"),
      artifactType: "PDF",
      capturedDownloadRequest: {
        actionId: "action-gstr3b",
        dataUrl: dataUrl("text/plain", "not a pdf"),
        safeSignals: ["portal-blob-captured"],
      },
      deps: {
        sendMessageToTabWithInjection: vi.fn(),
        storageKeys: {},
      },
      scope: {
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      target: {
        actionId: "action-gstr3b",
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      triggerStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "clicked",
        safeSignals: ["filed-gstr3b-download-clicked"],
        safeMessage: "Clicked.",
      },
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        safeSignals: ["filed-gstr3b-captured-download-data-url-rejected"],
        downloadDiagnostic: {
          returnType: "GSTR-3B",
          errorCategory: "filed-gstr3b-captured-download-data-url-rejected",
        },
      },
    });
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
            targetBinding: testCaptureBindingFromTarget(message.payload),
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

  it.each(["PDF", "EXCEL"] as const)(
    "does not issue a second GSTR-2B %s portal click when capture cannot stay dialog-free",
    async (artifactType) => {
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
              controlId: `control-${artifactType.toLowerCase()}`,
              maxBytes: 36 * 1024 * 1024,
              signalPrefix: "gstr2b",
              targetBinding: testCaptureBindingFromTarget(message.payload),
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
          artifactType,
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
          ]),
          downloadDiagnostic: {
            returnType: "GSTR-2B",
            period: "May",
            artifactType,
            downloadPathClass: "captured-portal-request-unknown",
            status: "unsupported-page",
          },
        },
      });
      expect(browser.downloads.download).not.toHaveBeenCalled();
      expect(observeBrowserDownloadById).not.toHaveBeenCalled();
      expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
        "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
        "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
      ]);
    },
  );

  it("fails closed immediately when a GSTR-2B portal click has no action-bound bytes", async () => {
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
    >(async (_tabId, message) => takeBoundResponse(responses, message));

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "EXCEL",
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
        state: "download-unconfirmed",
        safeSignals: expect.arrayContaining([
          "gstr2b-portal-blob-download-clicked",
          "filed-return-portal-click-evidence-unavailable",
          "filed-return-artifact-unconfirmed:EXCEL",
        ]),
        safeMessage: expect.stringContaining("not bound to this target"),
        downloadDiagnostic: {
          downloadPathClass: "portal-click-unknown",
          status: "download-unconfirmed",
        },
      },
    });
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(observeBrowserDownloadById).not.toHaveBeenCalled();
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
      filedGstr1CapturedDownload("PDF"),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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

  it("polls GSTR-1 detail immediately after opening a result row", async () => {
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
      filedGstr1CapturedDownload("PDF"),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
          resultRowNavigationSettleMs: 60_000,
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

  it("downloads GSTR-1 summary PDF and e-invoice details Excel through action-bound capture", async () => {
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
      filedGstr1CapturedDownload("PDF"),
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
      filedGstr1CapturedDownload("EXCEL"),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
          "single-period-bundle-recovered",
          "filed-return-artifact-downloaded:PDF",
          "filed-return-artifact-downloaded:EXCEL",
          "single-period-zip-downloaded",
          "single-period-opfs-cleared",
        ]),
        downloadDiagnostic: { artifactType: "EXCEL" },
        downloadDiagnostics: [
          { artifactType: "PDF", financialYear: "2025-26", period: "May" },
          { artifactType: "EXCEL", financialYear: "2025-26", period: "May" },
        ],
      },
    });
    if (!("flowStep" in response)) throw new Error("Expected a flow-step response.");
    const diagnosticActionIds =
      response.flowStep.downloadDiagnostics?.map((diagnostic) => diagnostic.actionId) ?? [];
    expect(new Set(diagnosticActionIds).size).toBe(2);
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "pack:filed-returns-target-review": expect.objectContaining({
        downloadDiagnostic: expect.objectContaining({ artifactType: "EXCEL" }),
        downloadDiagnostics: [
          expect.objectContaining({ artifactType: "PDF" }),
          expect.objectContaining({ artifactType: "EXCEL" }),
        ],
      }),
    });
    expect(browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "gstr-1-2025-26-may.zip", saveAs: false }),
    );
    expect(browser.scripting.executeScript).toHaveBeenCalledTimes(2);
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
  });

  it("reports GSTR-1 e-invoice details Excel completion with the Excel artifact label", async () => {
    mockCompletedBrowserDownload("spreadsheet");
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
      filedGstr1CapturedDownload("EXCEL"),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
    vi.mocked(browser.scripting.executeScript)
      .mockImplementationOnce(async (details) => [
        { result: mainWorldSuccessOutcomeForScriptingDetails(details) },
      ])
      .mockImplementationOnce(async (details) => {
        const config = captureConfigFromScriptingDetails(details);
        const signalPrefix = String(config?.signalPrefix ?? "filed-gstr1");
        return [
          {
            result: {
              capturedDownloadRequest: null,
              safeFailureSignals: [
                `${signalPrefix}-main-world-capture-armed`,
                `${signalPrefix}-main-world-capture-timeout`,
              ],
            },
          },
        ];
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
      filedGstr1CapturedDownload("PDF"),
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
      filedGstr1CapturedDownload("EXCEL"),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
        state: "user-action-required",
        safeSignals: expect.arrayContaining([
          "single-period-bundle-artifact-review-required",
          "single-period-bundle-running-ambiguous",
          "single-period-opfs-retained",
        ]),
      },
    });
    expect("flowStep" in response).toBe(true);
    if (!("flowStep" in response)) throw new Error("Expected a flow-step response.");
    expect(response.flowStep.userAction).toMatchObject({ canResume: false });
    const completionWrites = vi.mocked(browser.storage.session.set).mock.calls;
    expect(completionWrites.at(-1)?.[0]).toEqual({
      completion: expect.objectContaining({
        status: "blocked",
        flowStep: expect.objectContaining({
          safeSignals: expect.arrayContaining([
            "single-period-bundle-artifact-review-required",
            "single-period-opfs-retained",
          ]),
        }),
      }),
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "pack:single-period-staging": expect.objectContaining({
        phase: "artifact-review",
        scope: expect.objectContaining({
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-1",
        }),
        artifacts: [
          expect.objectContaining({ artifactType: "PDF", status: "staged" }),
          expect.objectContaining({ artifactType: "EXCEL", status: "running" }),
        ],
      }),
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
            targetBinding: testCaptureBindingFromTarget(message.payload),
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
        safeSignals: expect.arrayContaining(["filed-returns-target-review-required"]),
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
        safeSignals: expect.arrayContaining(["filed-returns-target-review-required"]),
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

  it("blocks a full-year start while a single-period target still needs review", async () => {
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
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["filed-returns-target-review-required"]),
      },
      flowSummary: {
        currentPeriod: "April",
        scope: { period: "April", returnType: "GSTR-3B" },
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
    expect(browser.storage.local.set).not.toHaveBeenCalledWith({
      "full-year-ledger": expect.anything(),
    });
  });

  it("stops at explicit user action when the DOM View attempt cannot navigate", async () => {
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => ({
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "user-action-required",
        safeSignals: ["filed-gstr1-result-view-user-action-required", "result-row-gstr1"],
        safeMessage: "The exact View control requires trusted input.",
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          message: "Click the exact View control.",
          canResume: true,
        },
      },
    }));

    const response = await startFiledReturnsDownloadFlow(
      {
        artifactType: "PDF",
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
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["filed-gstr1-result-view-user-action-required"]),
        userAction: { canResume: true },
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(1);
    expect(observeBrowserDownloadById).not.toHaveBeenCalled();
  });

  it("persists a single-period download result for popup status", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
      filedGstr3bCapturedDownload(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
    const responses: PackMessageResponse[] = [
      filedReturnDownloadReady("May"),
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
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
          portalNavigationSettleMs: 0,
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
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(MAX_GSTR1_FLOW_STEPS);
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
      filedGstr2bCapturedDownload(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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

    expect(response).toHaveProperty("flowStep");
    if (!(response.ok && "flowStep" in response)) throw new Error("Expected a flow step.");
    expect(response.flowStep.scopeId).toBe("gst-gstr2b-private-v0");
    expect(
      response.flowStep.safeSignals.filter((signal) => !isDurableFiledReturnsSignal(signal)),
    ).toEqual([]);

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
      filedGstr2bCapturedDownload(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
      filedGstr2bCapturedDownload(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
      filedGstr2bCapturedDownload(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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

  it("explicitly resumes a persisted full fiscal year ledger without repeating a downloaded period", async () => {
    stagedZipEntryCount = 1;
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
      filedGstr3bCapturedDownload(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false as const, error: "Unexpected call." };
      if (
        message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
        response.ok &&
        "mainWorldCaptureRequest" in response
      ) {
        bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
      }
      return response;
    });

    const response = await retryFullFiscalYearTargetDownloadFlow(
      {
        ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
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
    const responses = filedGstr3bCapturedPeriodResponses("April", "May");
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false as const, error: "Unexpected call." };
      if (
        message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
        response.ok &&
        "mainWorldCaptureRequest" in response
      ) {
        bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
      }
      return response;
    });

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
        runId: ACTIVE_RUN_ID,
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
        safeSignals: expect.arrayContaining(["filed-returns-target-review-required"]),
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  });

  it("retains completed full-year targets when the one final ZIP is unconfirmed", async () => {
    vi.mocked(observeBrowserDownloadById).mockResolvedValueOnce({
      state: "not-observed",
      safeSignals: ["browser-download-size-unknown"],
      safeMessage: "Unconfirmed.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Retry.",
        canResume: true,
      },
    });
    const responses = filedGstr3bCapturedPeriodResponses("April", "May");
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false as const, error: "Unexpected call." };
      if (
        message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
        response.ok &&
        "mainWorldCaptureRequest" in response
      ) {
        bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
      }
      return response;
    });

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
        completedPeriods: ["April", "May"],
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(4);
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        completedPeriods: ["April", "May"],
        status: "blocked",
      }),
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        status: "blocked",
        targets: expect.arrayContaining([
          expect.objectContaining({ period: "April", status: "downloaded" }),
          expect.objectContaining({ period: "May", status: "downloaded" }),
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
      error: `Could not reach ${filedGstr3bPdfUrl("052026")}`,
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
          ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
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
          ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
          targetId: "GSTR-3B:2026-27:May",
          expectedRevision: 1,
          targetStatus: "pending",
        },
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  });

  it("finishes same-scope ZIP cleanup without replaying completed full-year targets", async () => {
    mockLocalStorageGet({
      "full-year-ledger": {
        ...createFullFiscalYearLedger({
          status: "blocked",
          targets: [
            { period: "April", status: "downloaded" },
            { period: "May", status: "downloaded" },
          ],
        }),
        zipPhase: "downloaded-cleanup-pending",
      },
    });
    const responses = filedGstr3bCapturedPeriodResponses("April", "May");
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false as const, error: "Unexpected call." };
      if (
        message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
        response.ok &&
        "mainWorldCaptureRequest" in response
      ) {
        bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
      }
      return response;
    });

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
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
        status: "complete",
        zipPhase: "cleaned",
        targets: [
          expect.objectContaining({ period: "April", status: "downloaded" }),
          expect.objectContaining({ period: "May", status: "downloaded" }),
        ],
      }),
    });
  });

  it("keeps an older completed run blocked when its retained staging cannot be cleared", async () => {
    const completedLedger = {
      ...createFullFiscalYearLedger({
        status: "complete",
        targets: [
          { period: "April", status: "downloaded" },
          { period: "May", status: "downloaded" },
        ],
      }),
      zipPhase: undefined,
    };
    mockLocalStorageGet({ "full-year-ledger": completedLedger });
    const defaultRuntimeHandler = vi.mocked(browser.runtime.sendMessage).getMockImplementation()!;
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER"
      ) {
        const requestId =
          "payload" in message &&
          typeof message.payload === "object" &&
          message.payload !== null &&
          "requestId" in message.payload
            ? message.payload.requestId
            : undefined;
        return { ok: false, requestId, errorCategory: "clear-failed" };
      }
      return (defaultRuntimeHandler as (value: unknown) => unknown)(message);
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await startFiledReturnsDownloadFlow(completedLedger.scope, {
      getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
      sendMessageToTabWithInjection,
      storageKeys: {
        completion: "completion",
        fullFiscalYearLedger: "full-year-ledger",
        observation: "observation",
      },
      now: () => new Date("2026-06-24T00:02:00.000Z"),
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-local-cleanup-retry",
          "full-fiscal-year-zip-cleanup-pending",
          "full-fiscal-year-opfs-clear-failed",
        ]),
      },
      flowSummary: { status: "blocked" },
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        status: "blocked",
        zipPhase: "legacy-cleanup-pending",
      }),
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  });

  it("persists a newly eligible month before any stale final-phase action", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "complete",
        targets: [
          { period: "April", status: "downloaded" },
          { period: "May", status: "downloaded" },
        ],
      }),
    });
    const responses = filedGstr3bCapturedPeriodResponses("April", "May", "June");
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false as const, error: "Unexpected call." };
      if (
        message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
        response.ok &&
        "mainWorldCaptureRequest" in response
      ) {
        bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
      }
      return response;
    });

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
      flowStep: {
        state: "blocked",
        safeSignals: ["full-fiscal-year-resume-confirmation-required"],
      },
      flowSummary: {
        status: "running",
        completedPeriods: ["April", "May"],
        currentPeriod: "June",
        totalPeriods: 3,
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER" }),
    );
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
        eligibleThrough: "June",
        status: "running",
        targets: [
          expect.objectContaining({ period: "April", status: "downloaded" }),
          expect.objectContaining({ period: "May", status: "downloaded" }),
          expect.objectContaining({ period: "June", status: "pending" }),
        ],
      }),
    });
    const persistedLedgers = vi
      .mocked(browser.storage.local.set)
      .mock.calls.map(([value]) => (value as Record<string, unknown>)["full-year-ledger"])
      .filter(Boolean) as FiledReturnsFullFiscalYearLedger[];
    expect(persistedLedgers.at(-1)).not.toHaveProperty("zipPhase");
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
            ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
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

  it("treats a completed ledger with a non-successful target as malformed", async () => {
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
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-ledger-malformed",
          "full-fiscal-year-opfs-retained",
        ]),
      },
      flowSummary: {
        status: "blocked",
        completedPeriods: [],
        totalPeriods: 12,
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  });

  it("does not mutate a retry target when another run is active", async () => {
    mockLocalStorageGet({
      "active-run": {
        schemaVersion: "1.0",
        runId: ACTIVE_RUN_ID,
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
        ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
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

  it.each(["manually-observed", "cancelled"] as const)(
    "does not resolve a full-year target as %s while another run is active",
    async (resolution) => {
      const ledger = createFullFiscalYearLedger({
        status: "blocked",
        currentPeriod: "April",
        targets: [{ period: "April", status: "download-unconfirmed" }],
      });
      const activeRun = {
        schemaVersion: "1.0",
        runId: ACTIVE_RUN_ID,
        revision: 1,
        scope: {
          financialYear: "2026-27",
          period: "May",
          returnType: "GSTR-3B",
        },
        status: "running",
        leaseUpdatedAt: "2026-06-24T00:00:00.000Z",
      };
      mockLocalStorageGet({
        "active-run": activeRun,
        "full-year-ledger": ledger,
      });

      const response = await resolveFullFiscalYearTargetFlow(
        {
          ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
          targetId: "GSTR-3B:2026-27:April",
          expectedRevision: 1,
        },
        resolution,
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
        flowStep: {
          state: "user-action-required",
          safeSignals: ["filed-returns-run-active"],
        },
      });
      expect(localStorageValues["full-year-ledger"]).toEqual(ledger);
      expect(localStorageValues["active-run"]).toEqual(activeRun);
      expect(browser.storage.local.set).not.toHaveBeenCalled();
      expect(browser.storage.local.remove).not.toHaveBeenCalledWith("full-year-ledger");
      expect(browser.storage.local.remove).not.toHaveBeenCalledWith("target-review");
      expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    },
  );

  it("rechecks expectedRevision after acquiring the full-year resolution lease", async () => {
    const initialLedger = createFullFiscalYearLedger({
      status: "blocked",
      currentPeriod: "April",
      targets: [{ period: "April", status: "download-unconfirmed" }],
    });
    const newerLedger = { ...initialLedger, revision: 2 };
    mockLocalStorageGet({ "full-year-ledger": initialLedger });
    let ledgerReads = 0;
    vi.mocked(browser.storage.local.get).mockImplementation(async (keys) => {
      if (keys === "full-year-ledger") {
        ledgerReads += 1;
        if (ledgerReads === 1) {
          localStorageValues["full-year-ledger"] = newerLedger;
          return { "full-year-ledger": initialLedger };
        }
        return { "full-year-ledger": newerLedger };
      }
      if (typeof keys === "string") {
        return Object.hasOwn(localStorageValues, keys) ? { [keys]: localStorageValues[keys] } : {};
      }
      return { ...localStorageValues };
    });

    const response = await resolveFullFiscalYearTargetFlow(
      {
        ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 1,
      },
      "cancelled",
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
      flowStep: { safeSignals: ["full-fiscal-year-recovery-stale"] },
      flowSummary: { fullFiscalYearRecovery: { expectedRevision: 2 } },
    });
    expect(ledgerReads).toBe(2);
    expect(localStorageValues["full-year-ledger"]).toEqual(newerLedger);
    expect(browser.storage.local.set).not.toHaveBeenCalledWith({
      "full-year-ledger": expect.anything(),
    });
    expect(browser.storage.local.remove).not.toHaveBeenCalledWith("full-year-ledger");
    expect(browser.storage.local.remove).not.toHaveBeenCalledWith("target-review");
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("does not retry a full-year target while a target review is unresolved", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "blocked",
        currentPeriod: "April",
        targets: [{ period: "April", status: "blocked" }],
      }),
      "target-review": {
        schemaVersion: "1.0",
        targetId: "GSTR-3B:2026-27:May",
        status: "download-unconfirmed",
        scope: {
          financialYear: "2026-27",
          period: "May",
          returnType: "GSTR-3B",
        },
        safeSignals: ["browser-download-not-observed"],
        safeMessage: "The browser download was not confirmed.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await retryFullFiscalYearTargetDownloadFlow(
      {
        ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
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
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["filed-returns-target-review-required"]),
      },
      flowSummary: { scope: { period: "May" } },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
    expect(browser.storage.local.set).not.toHaveBeenCalledWith({
      "full-year-ledger": expect.anything(),
    });
  });

  it("clears the matching legacy target review before retrying a full-year target", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "blocked",
        currentPeriod: "April",
        targets: [{ period: "April", status: "blocked" }],
      }),
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
        safeMessage: "The browser download was not confirmed.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });

    const response = await retryFullFiscalYearTargetDownloadFlow(
      {
        ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 1,
      },
      {
        getActiveGstTab: vi.fn(async () => null),
        sendMessageToTabWithInjection: vi.fn(),
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "full-year-ledger",
          observation: "observation",
          targetReview: "target-review",
        },
      },
    );

    expect(response).not.toMatchObject({
      flowStep: { safeSignals: ["filed-returns-target-review-required"] },
    });
    expect(browser.storage.local.remove).toHaveBeenCalledWith("target-review");
    expect(vi.mocked(browser.storage.local.set).mock.calls).toEqual(
      expect.arrayContaining([
        [
          {
            "full-year-ledger": expect.objectContaining({
              currentTargetId: "GSTR-3B:2026-27:April",
              status: "running",
              targets: [expect.objectContaining({ period: "April", status: "pending" })],
            }),
          },
        ],
      ]),
    );
  });

  it("explicitly resumes a reconciled current-year ledger with newly eligible periods", async () => {
    stagedZipEntryCount = 2;
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
      filedGstr3bCapturedDownload(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => {
      const response = responses.shift() ?? { ok: false as const, error: "Unexpected call." };
      if (
        message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
        response.ok &&
        "mainWorldCaptureRequest" in response
      ) {
        bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
      }
      return response;
    });

    const response = await retryFullFiscalYearTargetDownloadFlow(
      {
        ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
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

  it("fails closed immediately after an ambiguous final trigger delivery", async () => {
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
          "filed-return-portal-click-evidence-unavailable",
          "filed-return-artifact-unconfirmed:PDF",
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
    expect(observeBrowserDownloadById).not.toHaveBeenCalled();
  }, 12_000);

  it("treats API result form post as filed-return detail navigation", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnApiResultPosted("March"),
      filedReturnDownloadReady("March"),
      filedGstr3bCapturedDownload(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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

  it("continues after the known GSTR-3B summary modal appears during API detail navigation", async () => {
    const responses: PackMessageResponse[] = [
      filedReturnApiResultPosted("March"),
      filedReturnSummaryModalOpen(),
      filedReturnDownloadReady("March"),
      filedGstr3bCapturedDownload(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
    expect(observeBrowserDownloadById).not.toHaveBeenCalled();
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
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-search-pending-marked"],
          safeMessage: "Search tracking prepared.",
        },
      },
      filedReturnDownloadReady("May"),
      filedGstr3bCapturedDownload(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));
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
      "PACK_CONTENT_MARK_FILED_RETURNS_SEARCH_PENDING_V3",
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
    ]);
  });

  it("clears search tracking when the main-world fallback does not submit Search", async () => {
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
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-search-pending-marked"],
          safeMessage: "Search tracking prepared.",
        },
      },
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-search-pending-cleared"],
          safeMessage: "Search tracking cleared.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));
    const selectFiltersInMainWorld = vi.fn<
      NonNullable<FiledReturnsFlowRunnerDeps["selectFiltersInMainWorld"]>
    >(async () => ({ state: "waiting", safeSignals: ["main-world-filter-selection-unstable"] }));

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
        timings: { flowStepSettleMs: 0, resultRowNavigationSettleMs: 0 },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: { state: "candidate-not-found" },
    });
    expect(sendMessageToTabWithInjection.mock.calls.map(([, message]) => message.type)).toEqual([
      "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      "PACK_CONTENT_MARK_FILED_RETURNS_SEARCH_PENDING_V3",
      "PACK_CONTENT_CLEAR_FILED_RETURNS_SEARCH_PENDING_V3",
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
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
      filedGstr2bCapturedDownload(),
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
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
        runId: ACTIVE_RUN_ID,
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

  it("keeps an ambiguous no-ID target review fail-closed instead of replaying the portal action", async () => {
    const scope = {
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B" as const,
    };
    const savedReview = {
      schemaVersion: "1.0" as const,
      targetId: "GSTR-3B:2025-26:March",
      status: "download-unconfirmed" as const,
      scope,
      safeSignals: ["filed-return-portal-click-evidence-unavailable"],
      safeMessage:
        "Pack used the verified portal control but did not persist an exact download ID.",
      updatedAt: "2026-06-24T00:00:00.000Z",
    };
    mockLocalStorageGet({ "target-review": savedReview });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await retryFiledReturnsTargetDownloadFlow(scope, {
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
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["filed-returns-target-review-required"]),
      },
    });
    expect(localStorageValues["target-review"]).toMatchObject({
      targetId: savedReview.targetId,
      status: savedReview.status,
      scope: savedReview.scope,
      safeSignals: savedReview.safeSignals,
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(browser.storage.local.remove).not.toHaveBeenCalledWith("target-review");
  });

  it("blocks a retry when the target review changes before its retry-safe checkpoint is cleared", async () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B" as const,
    };
    mockLocalStorageGet({
      "target-review": {
        downloadAttempt: {
          actionId: "action-m0abc123-marchpdf",
          artifactType: "PDF",
          downloadId: 91,
          kind: "single-artifact",
          phase: "download-observing",
          requestedAt: "2026-06-24T00:00:00.000Z",
        },
        revision: 1,
        schemaVersion: "1.0",
        targetId: "GSTR-3B:2025-26:March",
        status: "download-unconfirmed",
        scope,
        safeSignals: ["browser-download-size-unknown"],
        safeMessage: "Pack could not confirm the exact browser download.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });
    mockDownloadSearch([{ id: 91, state: "interrupted" }]);
    vi.mocked(observeBrowserDownloadById).mockResolvedValueOnce({
      state: "failed",
      safeSignals: ["browser-download-interrupted"],
      safeMessage: "The exact browser download was interrupted.",
    });
    const localGet = browser.storage.local.get as unknown as {
      getMockImplementation: () =>
        ((keys: unknown) => Promise<Record<string, unknown>>) | undefined;
      mockImplementation: (
        implementation: (keys: unknown) => Promise<Record<string, unknown>>,
      ) => void;
    };
    const defaultLocalGet = localGet.getMockImplementation()!;
    let concurrentRevisionInjected = false;
    localGet.mockImplementation(async (keys) => {
      if (keys === "target-review") {
        const current = localStorageValues[keys] as
          (Record<string, unknown> & { downloadAttempt?: unknown; revision?: number }) | undefined;
        if (
          !concurrentRevisionInjected &&
          current &&
          current.downloadAttempt === undefined &&
          current.revision === 2
        ) {
          concurrentRevisionInjected = true;
          localStorageValues[keys] = {
            ...current,
            revision: 3,
            updatedAt: "2026-06-24T00:00:06.000Z",
          };
          return { [keys]: current };
        }
      }
      return defaultLocalGet(keys);
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

    const response = await retryFiledReturnsTargetDownloadFlow(scope, {
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
    });

    expect(concurrentRevisionInjected).toBe(true);
    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["filed-returns-target-review-required"]),
      },
    });
    expect(localStorageValues["target-review"]).toMatchObject({ revision: 3 });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(browser.storage.local.remove).not.toHaveBeenCalledWith("target-review");
  });

  it("serializes target-review resolution behind the active-run lease", async () => {
    const scope = {
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B" as const,
    };
    mockLocalStorageGet({
      "active-run": {
        schemaVersion: "1.0",
        runId: ACTIVE_RUN_ID,
        revision: 1,
        scope: { financialYear: "2026-27", period: "May", returnType: "GSTR-3B" },
        status: "running",
        leaseUpdatedAt: "2026-06-24T00:00:00.000Z",
      },
      "target-review": {
        schemaVersion: "1.0",
        targetId: "GSTR-3B:2025-26:March",
        status: "download-unconfirmed",
        scope,
        safeSignals: ["browser-download-size-unknown"],
        safeMessage: "Pack could not confirm the browser download.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });

    const response = await resolveUnconfirmedFiledReturnsDownloadFlow(scope, "cancelled", {
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
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: { safeSignals: ["filed-returns-run-active"] },
    });
    expect(localStorageValues["target-review"]).toBeDefined();
    expect(browser.storage.local.remove).not.toHaveBeenCalledWith("target-review");
  });

  it("retries only local cleanup after a completed single-period ZIP", async () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "March" as const,
      returnType: "GSTR-2B" as const,
    };
    const pdfDiagnostic = positiveTestDownloadDiagnostic({
      actionSuffix: "zpdf",
      artifactType: "PDF",
      financialYear: scope.financialYear,
      period: scope.period,
      returnType: scope.returnType,
    });
    const excelDiagnostic = positiveTestDownloadDiagnostic({
      actionSuffix: "zexcel",
      artifactType: "EXCEL",
      financialYear: scope.financialYear,
      period: scope.period,
      returnType: scope.returnType,
    });
    mockLocalStorageGet({
      "pack:single-period-staging": {
        ledgerId: "single-period:11111111111111111111",
        schemaVersion: "1.0",
      },
      "target-review": {
        downloadDiagnostic: excelDiagnostic,
        downloadDiagnostics: [pdfDiagnostic, excelDiagnostic],
        schemaVersion: "1.0",
        targetId: "GSTR-2B:2025-26:March:PDF_AND_EXCEL",
        status: "download-unconfirmed",
        scope,
        safeSignals: [
          "filed-return-artifact-downloaded:PDF",
          "filed-return-artifact-downloaded:EXCEL",
          "single-period-opfs-staged:PDF",
          "single-period-opfs-staged:EXCEL",
          "single-period-zip-downloaded",
          "single-period-opfs-clear-failed",
        ],
        safeMessage: "ZIP complete; cleanup failed.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });
    const sendMessageToTabWithInjection =
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();
    vi.mocked(browser.runtime.sendMessage).mockImplementationOnce(async (message: unknown) => {
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
        return { ok: true, requestId: message.payload.requestId, cleared: true };
      }
      return { ok: false, errorCategory: "invalid-message" };
    });

    const response = await retryFiledReturnsTargetDownloadFlow(scope, {
      getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
      sendMessageToTabWithInjection,
      storageKeys: {
        completion: "completion",
        fullFiscalYearLedger: "full-year-ledger",
        observation: "observation",
        targetReview: "target-review",
      },
      now: () => new Date("2026-06-24T00:00:05.000Z"),
    });

    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
        payload: expect.objectContaining({
          ledgerId: "single-period:11111111111111111111",
        }),
      }),
    );
    const clearCallIndex = vi
      .mocked(browser.runtime.sendMessage)
      .mock.calls.findIndex(([message]) => {
        const messageWithType = message as { type?: unknown };
        return (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          messageWithType.type === "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER"
        );
      });
    expect(clearCallIndex).toBeGreaterThanOrEqual(0);
    await expect(
      vi.mocked(browser.runtime.sendMessage).mock.results[clearCallIndex]!.value,
    ).resolves.toMatchObject({ ok: true, cleared: true });
    expect(localStorageValues["pack:single-period-staging"]).toBeUndefined();
    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining([
          "single-period-zip-downloaded",
          "single-period-opfs-cleanup-completed",
          "single-period-opfs-cleared",
        ]),
      },
      flowSummary: { status: "complete", completedPeriods: ["March"] },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
    expect(browser.downloads.download).not.toHaveBeenCalled();
    expect(browser.storage.local.remove).toHaveBeenCalledWith("target-review");
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
      filedGstr3bCapturedDownload(),
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async (_tabId, message) => takeBoundResponse(responses, message));

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
          ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
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

async function createFailedInterruptedBundleReview() {
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
          safeSignals: ["gstr2b-summary-route", "filed-return-download-ready"],
          safeMessage: "Ready.",
        },
      } as PackMessageResponse;
    }
    if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
      return {
        ok: true,
        downloadTrigger: {
          connectorId: "gst",
          scopeId: "gst-gstr2b-private-v0",
          state: "blocked",
          safeSignals: ["portal-system-error"],
          safeMessage: "The portal blocked the selected artifact.",
        },
      } as PackMessageResponse;
    }
    return { ok: false, error: "Unexpected call." };
  });
  const scope = {
    artifactType: "PDF_AND_EXCEL" as const,
    financialYear: "2026-27",
    period: "May" as const,
    returnType: "GSTR-2B" as const,
  };
  const getActiveGstTab = vi.fn(async () => ACTIVE_GST_TAB);
  const deps: FiledReturnsFlowRunnerDeps = {
    getActiveGstTab,
    sendMessageToTabWithInjection,
    storageKeys: {
      completion: "completion",
      fullFiscalYearLedger: "full-year-ledger",
      observation: "observation",
      targetReview: "target-review",
    },
    timings: { flowStepSettleMs: 0, resultRowNavigationSettleMs: 0 },
  };
  let rejectFirstReviewWrite = true;
  vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
    if (rejectFirstReviewWrite && Object.hasOwn(values, "target-review")) {
      rejectFirstReviewWrite = false;
      throw new Error("Synthetic target-review write failure.");
    }
    Object.assign(localStorageValues, values);
  });

  const firstResponse = await startFiledReturnsDownloadFlow(scope, deps);

  expect(firstResponse).toMatchObject({
    ok: true,
    flowStep: {
      state: "blocked",
      safeSignals: expect.arrayContaining(["single-period-bundle-state-persist-failed"]),
    },
  });
  expect(localStorageValues["target-review"]).toBeUndefined();
  expect(localStorageValues["pack:single-period-staging"]).toMatchObject({
    phase: "artifact-review",
  });
  return { deps, getActiveGstTab, scope, sendMessageToTabWithInjection };
}

function clearPortalSideEffectMocks(
  harness: Awaited<ReturnType<typeof createFailedInterruptedBundleReview>>,
): void {
  harness.getActiveGstTab.mockClear();
  harness.sendMessageToTabWithInjection.mockClear();
  vi.mocked(browser.scripting.executeScript).mockClear();
  vi.mocked(browser.downloads.download).mockClear();
}

function expectNoPortalSideEffects(
  harness: Awaited<ReturnType<typeof createFailedInterruptedBundleReview>>,
): void {
  expect(harness.getActiveGstTab).not.toHaveBeenCalled();
  expect(harness.sendMessageToTabWithInjection).not.toHaveBeenCalled();
  expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  expect(browser.downloads.download).not.toHaveBeenCalled();
}

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
      scopeId: "gst-gstr2b-private-v0",
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

it("blocks another full-year scope while a prepared ZIP ledger is retained", async () => {
  const retainedLedger = createFullFiscalYearLedger({
    status: "blocked",
    targets: [
      { period: "April", status: "downloaded" },
      { period: "May", status: "downloaded" },
    ],
  });
  mockLocalStorageGet({ "full-year-ledger": retainedLedger });
  const sendMessageToTabWithInjection =
    vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

  const response = await startFiledReturnsDownloadFlow(
    {
      artifactType: "PDF",
      financialYear: "2025-26",
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
    },
  );

  expect(response).toMatchObject({
    ok: true,
    flowStep: {
      state: "blocked",
      safeSignals: expect.arrayContaining([
        "full-fiscal-year-retained-staging-scope-conflict",
        "full-fiscal-year-final-zip-retry",
        "full-fiscal-year-opfs-retained",
      ]),
    },
    flowSummary: {
      scope: retainedLedger.scope,
      status: "blocked",
    },
  });
  expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  expect(browser.storage.local.set).not.toHaveBeenCalled();
});

it("blocks a new full-year run when malformed metadata retains an OPFS cleanup id", async () => {
  mockLocalStorageGet({
    "full-year-ledger": {
      ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
      schemaVersion: "unexpected",
    },
  });
  const sendMessageToTabWithInjection =
    vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

  const response = await startFiledReturnsDownloadFlow(
    {
      artifactType: "PDF",
      financialYear: "2025-26",
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
    },
  );

  expect(response).toMatchObject({
    ok: true,
    flowStep: {
      state: "blocked",
      safeSignals: ["full-fiscal-year-ledger-malformed", "full-fiscal-year-opfs-retained"],
    },
  });
  expect(browser.storage.local.set).not.toHaveBeenCalled();
  expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
});

it("blocks a new download when target-review recovery metadata is malformed", async () => {
  const scope = {
    artifactType: "PDF" as const,
    financialYear: "2026-27",
    period: "April",
    returnType: "GSTR-3B" as const,
  };
  const malformedReview = {
    downloadAttempt: {
      actionId: "action-april-pdf",
      artifactType: "PDF",
      downloadId: 91,
      kind: "single-artifact",
      phase: "download-observing",
      requestedAt: "2026-07-24T00:00:00.000Z",
      url: "synthetic-forbidden-url",
    },
    safeMessage: "The saved browser download needs reconciliation.",
    safeSignals: ["browser-download-size-unknown"],
    schemaVersion: "1.0",
    scope,
    status: "download-unconfirmed",
    targetId: "GSTR-3B:2026-27:April",
    updatedAt: "2026-07-24T00:00:00.000Z",
  };
  mockLocalStorageGet({ "target-review": malformedReview });
  const localGet = browser.storage.local.get as unknown as {
    mockResolvedValueOnce: (value: Record<string, unknown>) => void;
  };
  localGet.mockResolvedValueOnce({ "target-review": malformedReview });
  const sendMessageToTabWithInjection =
    vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();
  const removeCallCount = vi.mocked(browser.storage.local.remove).mock.calls.length;

  const response = await startFiledReturnsDownloadFlow(scope, {
    getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
    sendMessageToTabWithInjection,
    storageKeys: {
      completion: "completion",
      fullFiscalYearLedger: "full-year-ledger",
      observation: "observation",
      targetReview: "target-review",
    },
  });

  expect(response).toMatchObject({
    ok: true,
    flowStep: {
      safeSignals: ["filed-returns-target-review-malformed"],
      state: "blocked",
      userAction: { canResume: false },
    },
  });
  expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  expect(browser.downloads.download).not.toHaveBeenCalled();
  expect(browser.storage.local.remove).toHaveBeenCalledTimes(removeCallCount + 1);
});

it("blocks a new full-year run when malformed metadata has no safe cleanup id", async () => {
  mockLocalStorageGet({
    "full-year-ledger": {
      ledgerId: "unsafe/ledger",
      schemaVersion: "unexpected",
    },
  });
  const sendMessageToTabWithInjection =
    vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

  const response = await startFiledReturnsDownloadFlow(
    {
      artifactType: "PDF",
      financialYear: "2025-26",
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
    },
  );

  expect(response).toMatchObject({
    ok: true,
    flowStep: {
      state: "blocked",
      safeSignals: ["full-fiscal-year-ledger-malformed"],
    },
  });
  expect(browser.storage.local.set).not.toHaveBeenCalled();
  expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
});

it("preserves partially staged artifacts before replacing a blocked same-scope run", async () => {
  const partialLedger = createFullFiscalYearLedger({
    status: "blocked",
    currentPeriod: "April",
    targets: [{ period: "April", status: "blocked" }],
  });
  partialLedger.targets[0] = {
    ...partialLedger.targets[0]!,
    safeSignals: ["full-fiscal-year-opfs-staged", "full-fiscal-year-opfs-staged:PDF"],
  };
  mockLocalStorageGet({ "full-year-ledger": partialLedger });
  const sendMessageToTabWithInjection =
    vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>();

  const response = await startFiledReturnsDownloadFlow(partialLedger.scope, {
    getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
    sendMessageToTabWithInjection,
    storageKeys: {
      completion: "completion",
      fullFiscalYearLedger: "full-year-ledger",
      observation: "observation",
    },
  });

  expect(response).toMatchObject({
    ok: true,
    flowStep: {
      state: "blocked",
      safeSignals: expect.arrayContaining([
        "full-fiscal-year-run-needs-action",
        "full-fiscal-year-opfs-staged:PDF",
      ]),
    },
    flowSummary: {
      fullFiscalYearRecovery: {
        ledgerId: partialLedger.ledgerId,
        targetId: partialLedger.targets[0]!.targetId,
      },
    },
  });
  expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
  expect(browser.storage.local.set).not.toHaveBeenCalledWith({
    "full-year-ledger": expect.objectContaining({
      ledgerId: expect.not.stringMatching(/^full-fiscal-year-12345678$/),
    }),
  });
});

it("replaces a completed PDF ledger when the same full year starts as Excel", async () => {
  const now = "2026-06-24T00:00:00.000Z";
  const completedPdfLedger: FiledReturnsFullFiscalYearLedger = {
    schemaVersion: "1.0",
    planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
    eligibleThrough: "March",
    ledgerId: "full-fiscal-year-87654321",
    revision: 1,
    status: "complete",
    zipPhase: "cleaned",
    scope: {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-2B",
    },
    createdAt: now,
    updatedAt: now,
    targets: FILED_RETURNS_MONTHS.map((period, index) => {
      const scope = {
        artifactType: "PDF" as const,
        financialYear: "2025-26",
        period,
        returnType: "GSTR-2B" as const,
      };
      const downloadDiagnostic = positiveTestDownloadDiagnostic({
        actionSuffix: `p${String(index).padStart(2, "0")}`,
        artifactType: "PDF",
        downloadId: index,
        financialYear: scope.financialYear,
        period,
        returnType: scope.returnType,
      });
      return {
        targetId: `GSTR-2B:2025-26:${period}`,
        ...scope,
        status: "downloaded" as const,
        attempts: 1,
        ...canonicalDurableTargetStatus(scope, "downloaded", [
          "filed-return-artifact-downloaded:PDF",
          "full-fiscal-year-opfs-staged:PDF",
        ]),
        downloadDiagnostic,
        completedAt: now,
        updatedAt: now,
      };
    }),
  };
  mockLocalStorageGet({ "full-year-ledger": completedPdfLedger });
  const sendMessageToTabWithInjection = vi.fn<
    FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
  >(async () => ({ ok: false, error: "Stop after proving the replacement scope." }));

  const response = await startFiledReturnsDownloadFlow(
    {
      artifactType: "EXCEL",
      financialYear: "2025-26",
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
      now: () => new Date(now),
      timings: {
        flowStepSettleMs: 0,
        resultRowNavigationSettleMs: 0,
      },
    },
  );

  expect(response).toMatchObject({ ok: false });
  expect(sendMessageToTabWithInjection).toHaveBeenCalled();
  expect(browser.storage.local.set).toHaveBeenCalledWith({
    "full-year-ledger": expect.objectContaining({
      scope: expect.objectContaining({
        artifactType: "EXCEL",
        financialYear: "2025-26",
        returnType: "GSTR-2B",
      }),
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
  artifactType: "PDF" | "JSON" | "EXCEL",
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
      scopeId: "gst-gstr2b-private-v0",
      state: "clicked",
      safeSignals: ["gstr2b-return-dashboard-loading"],
      safeMessage: "Waiting for GSTR-2B dashboard controls.",
    },
  };
}

function takeBoundResponse(
  responses: PackMessageResponse[],
  message: Parameters<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>[1],
): PackMessageResponse {
  const response = responses.shift() ?? { ok: false as const, error: "Unexpected call." };
  if (
    message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" &&
    response.ok &&
    "mainWorldCaptureRequest" in response
  ) {
    bindTestCaptureRequest(response.mainWorldCaptureRequest, message.payload);
  }
  return response;
}

function gstr2bDownloadReady(period: FiledReturnsMonth): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-gstr2b-private-v0",
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

function filedGstr3bCapturedDownload(
  period: FiledReturnsMonth = "May",
  financialYear = "2026-27",
): PackMessageResponse {
  return {
    ok: true,
    mainWorldCaptureRequest: {
      actionId: "action-captured",
      controlAttribute: "data-pack-gstr2b-capture-action",
      controlId: "control-gstr3b-pdf",
      maxBytes: 36 * 1024 * 1024,
      signalPrefix: "filed-gstr3b",
      targetBinding: testCaptureBinding("GSTR-3B", financialYear, period, "PDF"),
      timeoutMs: 30_000,
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
      safeMessage: "Captured PDF.",
    },
  };
}

function filedGstr3bCapturedPeriodResponses(
  ...periods: FiledReturnsMonth[]
): PackMessageResponse[] {
  return periods.flatMap((period) => [
    filedReturnRowOpened(period),
    filedGstr3bCapturedDownload(period),
  ]);
}

function filedGstr1CapturedDownload(
  artifactType: "PDF" | "EXCEL",
  period: FiledReturnsMonth = "March",
  financialYear = "2025-26",
): PackMessageResponse {
  return {
    ok: true,
    mainWorldCaptureRequest: {
      actionId: "action-captured",
      controlAttribute: "data-pack-gstr2b-capture-action",
      controlId: `control-gstr1-${artifactType.toLowerCase()}`,
      maxBytes: 36 * 1024 * 1024,
      signalPrefix: "filed-gstr1",
      targetBinding: testCaptureBinding("GSTR-1", financialYear, period, artifactType),
      timeoutMs: 15_000,
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
        artifactType === "EXCEL" ? "text-download-excel-gstr1" : "download-pdf-gstr1-visible",
      ],
      safeMessage: `Captured ${artifactType}.`,
    },
  };
}

function filedGstr2bCapturedDownload(
  period: FiledReturnsMonth = "May",
  financialYear = "2026-27",
  artifactType: "PDF" | "EXCEL" = "PDF",
): PackMessageResponse {
  return {
    ok: true,
    mainWorldCaptureRequest: {
      actionId: "action-captured",
      controlAttribute: "data-pack-gstr2b-capture-action",
      controlId: `control-gstr2b-${artifactType.toLowerCase()}`,
      maxBytes: 36 * 1024 * 1024,
      signalPrefix: "filed-gstr2b",
      targetBinding: testCaptureBinding("GSTR-2B", financialYear, period, artifactType),
      timeoutMs: 15_000,
    },
    downloadTrigger: {
      connectorId: "gst",
      scopeId: "gst-gstr2b-private-v0",
      state: "clicked",
      safeSignals: [
        "filed-return-download-clicked",
        "filed-gstr2b-download-clicked",
        "filed-gstr2b-portal-blob-download-captured",
        "filed-gstr2b-extension-download-requested",
      ],
      safeMessage: `Captured GSTR-2B ${artifactType}.`,
    },
  };
}

function testCaptureBinding(
  returnType: "GSTR-1" | "GSTR-2B" | "GSTR-3B",
  financialYear: string,
  period: FiledReturnsMonth,
  artifactType: "PDF" | "EXCEL",
) {
  return {
    artifactType,
    controlTextDigest: "1234abcd",
    financialYear,
    pathnameDigest: "abcd1234",
    period,
    returnType,
  };
}

function testCaptureBindingFromTarget(target: FiledReturnsDownloadTarget) {
  return testCaptureBinding(
    target.returnType,
    target.financialYear,
    target.period as FiledReturnsMonth,
    target.artifactType === "JSON" ? "PDF" : (target.artifactType ?? "PDF"),
  );
}

function bindTestCaptureRequest(
  request: FiledReturnsMainWorldCaptureRequest,
  target: FiledReturnsDownloadTarget,
): void {
  request.actionId = target.actionId;
  request.targetBinding = testCaptureBindingFromTarget(target);
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
  ).map((target, index) => {
    const scope = {
      financialYear: "2026-27",
      period: target.period,
      returnType: "GSTR-3B" as const,
    };
    const safeSignals =
      target.status === "downloaded"
        ? [
            "filed-return-artifact-downloaded:PDF",
            "full-fiscal-year-opfs-staged",
            "full-fiscal-year-opfs-staged:PDF",
          ]
        : [];
    const downloadDiagnostic =
      target.status === "downloaded"
        ? ({
            actionId: `action-12345678-t${index}`,
            artifactType: "PDF",
            byteCountClass: "non-empty",
            downloadPathClass: "captured-portal-request-data",
            endpointClass: "gstr3b-portal-blob-captured-download",
            eventType: "filed-return-download-path",
            financialYear: scope.financialYear,
            mimeClass: "pdf",
            period: scope.period,
            returnType: scope.returnType,
            schemaVersion: "1.0",
            status: "downloaded",
          } satisfies FiledReturnsDownloadDiagnostic)
        : null;
    return {
      targetId: `GSTR-3B:2026-27:${target.period}`,
      ...scope,
      status: target.status,
      attempts: target.status === "pending" ? 0 : 1,
      ...canonicalDurableTargetStatus(scope, target.status, safeSignals),
      ...(downloadDiagnostic ? { downloadDiagnostic } : {}),
      updatedAt: now,
      ...(target.status === "downloaded" ? { completedAt: now } : {}),
    };
  });
  const hasCanonicalTargetPrefix = ledgerTargets.every(
    (target, index) => target.period === FILED_RETURNS_MONTHS[index],
  );
  const eligibleThrough = hasCanonicalTargetPrefix ? ledgerTargets.at(-1)?.period : undefined;

  return {
    schemaVersion: "1.0",
    ...(eligibleThrough
      ? {
          planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
          eligibleThrough,
        }
      : {}),
    ledgerId: FULL_FISCAL_YEAR_LEDGER_ID,
    revision: 1,
    connectorVersion: GST_CONNECTOR_DESCRIPTOR.version,
    createdWithExtensionVersion: PACK_PRODUCT_VERSION,
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
    ...(status === "complete" ? { zipPhase: "cleaned" as const } : {}),
  };
}

function mockLocalStorageGet(value: Record<string, unknown>): void {
  localStorageValues = value;
}

function fullYearRunnerDeps(): FiledReturnsFlowRunnerDeps {
  return {
    getActiveGstTab: vi.fn(async () => null),
    sendMessageToTabWithInjection:
      vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>(),
    storageKeys: {
      completion: "completion",
      fullFiscalYearLedger: "full-year-ledger",
      observation: "observation",
    },
    now: () => new Date("2026-06-24T00:01:00.000Z"),
  };
}

function createStagedFinalZipLedger(
  zipPhase: NonNullable<FiledReturnsFullFiscalYearLedger["zipPhase"]>,
  zipDownloadAttempt?: FiledReturnsFullFiscalYearLedger["zipDownloadAttempt"],
): FiledReturnsFullFiscalYearLedger {
  const ledger = createFullFiscalYearLedger({
    status: "blocked",
    targets: [
      { period: "April", status: "downloaded" },
      { period: "May", status: "downloaded" },
    ],
  });
  return {
    ...ledger,
    zipPhase,
    ...(zipDownloadAttempt ? { zipDownloadAttempt } : {}),
    targets: ledger.targets.map((target) => ({
      ...target,
      safeSignals: ["full-fiscal-year-opfs-staged", "full-fiscal-year-opfs-staged:PDF"],
    })),
  };
}

function mockDownloadSearch(items: DownloadCreatedItem[]): void {
  const search = browser.downloads.search as unknown as {
    mockResolvedValue: (nextValue: DownloadCreatedItem[]) => void;
  };
  search.mockResolvedValue(items);
}

function mockCompletedBrowserDownload(mimeClass: "pdf" | "spreadsheet"): void {
  vi.mocked(observeBrowserDownloadById).mockResolvedValueOnce({
    state: "completed",
    safeSignals: ["browser-download-completed", "browser-download-non-empty"],
    safeMessage: "Completed.",
    safeEvidence: {
      byteCountClass: "non-empty",
      downloadId: 81,
      mimeClass,
      urlClass: "blob",
    },
  });
}

function positiveTestDownloadDiagnostic({
  actionSuffix,
  artifactType,
  downloadId,
  financialYear,
  period,
  returnType,
}: {
  actionSuffix: string;
  artifactType: "PDF" | "EXCEL";
  downloadId?: number;
  financialYear: string;
  period: FiledReturnsMonth;
  returnType: "GSTR-1" | "GSTR-2B" | "GSTR-3B";
}): FiledReturnsDownloadDiagnostic {
  return {
    schemaVersion: "1.0",
    eventType: "filed-return-download-path",
    actionId: `action-87654321-${actionSuffix}`,
    returnType,
    financialYear,
    period,
    endpointClass:
      returnType === "GSTR-3B"
        ? "gstr3b-portal-blob-captured-download"
        : returnType === "GSTR-2B"
          ? "gstr2b-portal-blob-captured-download"
          : artifactType === "PDF"
            ? "gstr1-pdf-portal-blob-captured-download"
            : "gstr1-excel-portal-blob-captured-download",
    artifactType,
    downloadPathClass: "captured-portal-request-data",
    ...(downloadId !== undefined ? { downloadId } : {}),
    status: "downloaded",
    mimeClass: artifactType === "PDF" ? "pdf" : "spreadsheet",
    byteCountClass: "non-empty",
  };
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

function filedGstr3bPdfUrl(returnPeriod: string): string {
  return gstReturnsUrl("/returns/auth/gstr3b/download.pdf", { rtn_prd: returnPeriod });
}

function gstReturnsUrl(pathname: string, searchParams: Record<string, string> = {}): string {
  const url = new URL(pathname, GST_RETURNS_ORIGIN);
  for (const [key, value] of Object.entries(searchParams)) url.searchParams.set(key, value);
  return url.href;
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

function captureConfigFromScriptingDetails(details: unknown): Record<string, unknown> | undefined {
  const args =
    typeof details === "object" && details !== null && "args" in details ? details.args : null;
  const firstArg = Array.isArray(args) ? args[0] : null;
  return typeof firstArg === "object" && firstArg !== null
    ? (firstArg as Record<string, unknown>)
    : undefined;
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

function mainWorldSuccessOutcomeForScriptingDetails(details: unknown) {
  const config = captureConfigFromScriptingDetails(details);
  const signalPrefix =
    typeof config?.signalPrefix === "string" ? config.signalPrefix : "filed-gstr3b";
  return {
    capturedDownloadRequest: {
      actionId: actionIdFromScriptingDetails(details),
      dataUrl: dataUrlForScriptingDetails(details),
      safeSignals: [
        `${signalPrefix}-portal-blob-captured`,
        `${signalPrefix}-native-blob-click-suppressed`,
        `${signalPrefix}-main-world-capture`,
      ],
    },
    safeFailureSignals: [],
  };
}
