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
import { observeNextBrowserDownload } from "../../src/background/download-observer";
import { browser } from "wxt/browser";

vi.mock("wxt/browser", () => ({
  browser: {
    downloads: {},
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
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-result-view-clicked", "filed-return-result-period:April"],
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
    expect(sentPeriods).toEqual(["April", "April", "May", "May"]);
    expect(sentPeriods).not.toContain(FULL_FISCAL_YEAR_PERIOD);
    expect(sentPeriods).not.toContain("ALL");
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

  it("resumes a persisted full fiscal year ledger without repeating a downloaded period", async () => {
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
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked",
          safeSignals: ["filed-return-result-view-clicked", "filed-return-result-period:April"],
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
        },
      });
      expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
      expect(browser.storage.local.set).not.toHaveBeenCalledWith({
        "full-year-ledger": expect.objectContaining({ status: "complete" }),
      });
    },
  );

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

  it("reconciles a completed current-year ledger with newly eligible periods", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createFullFiscalYearLedger({
        status: "complete",
        currentPeriod: "May",
        updatedAt: "2026-06-24T00:00:00.000Z",
        targets: [
          { period: "April", status: "downloaded" },
          { period: "May", status: "downloaded" },
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
      type: "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD",
      payload: expect.objectContaining({
        actionId: expect.any(String),
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      }),
    });
    expect(observeNextBrowserDownload).toHaveBeenCalledTimes(1);
  }, 12_000);

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
});

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
