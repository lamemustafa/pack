import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackMessageResponse } from "../../src/core/messages";
import {
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
          state: observation.state === "failed" ? "blocked" : "user-action-required",
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
  });

  it("continues a full-year flow after a month download and marks that period complete", async () => {
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
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "downloaded",
          safeSignals: ["filed-return-financial-year-complete"],
          safeMessage: "Complete.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "ALL",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          observation: "observation",
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: ["filed-return-financial-year-complete"],
      },
    });
    expect(browser.tabs.goBack).not.toHaveBeenCalled();
    expect(sendMessageToTabWithInjection).toHaveBeenLastCalledWith(
      17,
      expect.objectContaining({
        payload: expect.objectContaining({
          completedPeriods: ["March"],
        }),
      }),
    );
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        completedAt: expect.any(String),
        scope: {
          financialYear: "2025-26",
          period: "ALL",
          returnType: "GSTR-3B",
        },
        status: "complete",
        completedPeriods: ["March"],
        flowStep: expect.objectContaining({
          safeSignals: ["filed-return-financial-year-complete"],
        }),
      }),
    });
  }, 12_000);

  it("marks the period complete when a full-year run starts on a detail page", async () => {
    const responses: PackMessageResponse[] = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "ready",
          safeSignals: [
            "filed-gstr3b-download-ready",
            "filed-return-detail-period:March",
            "filed-return-detail-financial-year:2025-26",
          ],
          safeMessage: "Ready.",
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
          safeSignals: ["filed-return-detail-back-clicked"],
          safeMessage: "Returned.",
        },
      },
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "downloaded",
          safeSignals: ["filed-return-financial-year-complete"],
          safeMessage: "Complete.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "ALL",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          observation: "observation",
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: ["filed-return-financial-year-complete"],
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenNthCalledWith(2, 17, {
      type: "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD",
      payload: expect.objectContaining({
        actionId: expect.any(String),
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      }),
    });
    expect(sendMessageToTabWithInjection).toHaveBeenLastCalledWith(
      17,
      expect.objectContaining({
        payload: expect.objectContaining({
          completedPeriods: ["March"],
        }),
      }),
    );
  }, 12_000);

  it("does not continue a full-year run when the browser download is unconfirmed", async () => {
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
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "downloaded",
          safeSignals: ["filed-return-financial-year-complete"],
          safeMessage: "Complete.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "ALL",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          observation: "observation",
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["browser-download-size-unknown"]),
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(2);
    expect(browser.storage.session.set).not.toHaveBeenCalledWith({
      completion: expect.anything(),
    });
  }, 12_000);

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
          observation: "observation",
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
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
  }, 12_000);

  it("stops a full-year run when a successful detail download has no verified period", async () => {
    const responses: PackMessageResponse[] = [
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "ready",
          safeSignals: ["filed-gstr3b-download-ready"],
          safeMessage: "Ready.",
        },
      },
    ];
    const sendMessageToTabWithInjection = vi.fn<
      FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]
    >(async () => responses.shift() ?? { ok: false, error: "Unexpected call." });

    const response = await startFiledReturnsDownloadFlow(
      {
        financialYear: "2025-26",
        period: "ALL",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          observation: "observation",
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["filed-return-detail-period-unverified"]),
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
        },
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(1);
  }, 12_000);

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
          safeSignals: ["filed-return-financial-year-complete"],
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
        period: "ALL",
        returnType: "GSTR-3B",
      },
      {
        getActiveGstTab: vi.fn(async () => ACTIVE_GST_TAB),
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: "completion",
          observation: "observation",
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        safeSignals: ["filed-return-financial-year-complete"],
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(3);
  }, 12_000);
});
