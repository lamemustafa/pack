import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";

const browserMocks = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
  storage: {
    session: {
      get: vi.fn(async (key: string) => ({ [key]: browserMocks.session[key] })),
      remove: vi.fn(async (key: string) => {
        delete browserMocks.session[key];
      }),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(browserMocks.session, values);
      }),
    },
  },
  tabs: {
    get: vi.fn(),
    update: vi.fn(async () => undefined),
  },
  windows: { update: vi.fn(async () => undefined) },
}));
const flowMocks = vi.hoisted(() => ({
  triggerSelectedArtifacts: vi.fn(),
  preflightSelectedArtifactsRecovery: vi.fn(async () => null),
  reconcileArtifactAcquisitionCheckpoint: vi.fn(async () => ({ state: "none" })),
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));
vi.mock("../../src/background/artifact-acquisition-state", () => ({
  reconcileArtifactAcquisitionCheckpoint: flowMocks.reconcileArtifactAcquisitionCheckpoint,
}));
vi.mock("../../src/background/filed-returns-selected-artifacts", () => ({
  preflightSelectedArtifactsRecovery: flowMocks.preflightSelectedArtifactsRecovery,
  triggerSelectedArtifacts: flowMocks.triggerSelectedArtifacts,
}));

import { startSinglePeriodFiledReturnsDownloadFlow } from "../../src/background/filed-returns-single-period-flow";

const scope = {
  artifactType: "PDF" as const,
  financialYear: "2026-27",
  period: "April",
  returnType: "GSTR-3B" as const,
};

describe("single-period tab identity blocks", () => {
  beforeEach(() => {
    browserMocks.session = {};
    vi.clearAllMocks();
    flowMocks.preflightSelectedArtifactsRecovery.mockResolvedValue(null);
    flowMocks.reconcileArtifactAcquisitionCheckpoint.mockResolvedValue({ state: "none" });
  });

  it("keeps the immediate pinned-tab block equal to its persisted summary message", async () => {
    browserMocks.tabs.get.mockRejectedValueOnce(new Error("tab unavailable"));

    const response = await startSinglePeriodFiledReturnsDownloadFlow(scope, deps(), {
      requiredPortalTabId: 42,
    });

    expect(response).toMatchObject({
      flowStep: { safeSignals: ["full-fiscal-year-pinned-gst-tab-unavailable"] },
    });
    assertImmediateAndPersistedMessagesMatch(response);
  });

  it("keeps the immediate tab-focus block equal to its persisted summary message", async () => {
    browserMocks.tabs.update.mockRejectedValueOnce(new Error("synthetic focus failure"));

    const response = await startSinglePeriodFiledReturnsDownloadFlow(scope, deps());

    expect(response).toMatchObject({
      flowStep: {
        safeMessage:
          "Pack could not focus the selected GST Portal tab and will not start another portal action.",
        safeSignals: ["filed-returns-gst-tab-focus-unavailable"],
      },
    });
    assertImmediateAndPersistedMessagesMatch(response);
  });

  it("does not start portal work when the selected tab window cannot be focused", async () => {
    browserMocks.windows.update.mockRejectedValueOnce(new Error("synthetic window focus failure"));

    const response = await startSinglePeriodFiledReturnsDownloadFlow(scope, deps());

    expect(response).toMatchObject({
      flowStep: { safeSignals: ["filed-returns-gst-tab-focus-unavailable"] },
    });
    expect(flowMocks.triggerSelectedArtifacts).not.toHaveBeenCalled();
    assertImmediateAndPersistedMessagesMatch(response);
  });

  it("keeps the immediate tab-session block equal to its persisted summary message", async () => {
    browserMocks.storage.session.get.mockRejectedValueOnce(new Error("session unavailable"));

    const response = await startSinglePeriodFiledReturnsDownloadFlow(scope, deps(), {
      onPortalTabSelected: vi.fn(),
    });

    expect(response).toMatchObject({
      flowStep: { safeSignals: ["full-fiscal-year-gst-tab-session-unavailable"] },
    });
    assertImmediateAndPersistedMessagesMatch(response);
  });

  it("retains a pinned plan when its tab-session storage cannot be read", async () => {
    browserMocks.storage.session.get.mockRejectedValueOnce(new Error("session unavailable"));

    const response = await startSinglePeriodFiledReturnsDownloadFlow(scope, deps(), {
      requiredPortalTabId: 42,
      requiredPortalTabSessionId: "saved-browser-session-marker",
    });

    expect(response).toMatchObject({
      flowStep: { safeSignals: ["full-fiscal-year-gst-tab-session-unavailable"] },
    });
    expect(browserMocks.tabs.get).not.toHaveBeenCalled();
    assertImmediateAndPersistedMessagesMatch(response);
  });

  it("blocks before target work when portal-owned dashboard navigation is refused", async () => {
    const openReturnsDashboardWithPortalAnchor = vi.fn(async () => "not-found" as const);
    const sendMessageToTabWithInjection = vi.fn();
    const response = await startSinglePeriodFiledReturnsDownloadFlow(scope, {
      ...deps(),
      openReturnsDashboardWithPortalAnchor,
      sendMessageToTabWithInjection,
      timings: { returnsDashboardNavigationTimeoutMs: 0 },
    });

    expect(openReturnsDashboardWithPortalAnchor).toHaveBeenCalledExactlyOnceWith(17);
    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: ["wrong-origin-open-returns-dashboard", "returns-dashboard-anchor-not-found"],
        userAction: { type: "NAVIGATE_TO_SUPPORTED_PAGE" },
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
    expect(flowMocks.triggerSelectedArtifacts).not.toHaveBeenCalled();
    expect(browserMocks.tabs.update).toHaveBeenCalledExactlyOnceWith(17, { active: true });
    expect(browserMocks.session.completion).toMatchObject({
      status: "blocked",
      completedPeriods: [],
      flowStep: {
        state: "blocked",
        safeSignals: ["wrong-origin-open-returns-dashboard", "returns-dashboard-anchor-not-found"],
      },
    });
  });
});

function deps() {
  return {
    getActiveGstTab: async () => ({
      id: 17,
      incognito: false,
      url: "not-a-supported-gst-tab",
      windowId: 9,
    }),
    storageKeys: {
      completion: "completion",
      fullFiscalYearLedger: "ledger",
      observation: "observation",
    },
  } as FiledReturnsFlowRunnerDeps;
}

function assertImmediateAndPersistedMessagesMatch(
  response: Awaited<ReturnType<typeof startSinglePeriodFiledReturnsDownloadFlow>>,
) {
  if (!response.ok || !("flowStep" in response) || !response.flowSummary) {
    throw new Error("expected a persisted terminal flow response");
  }
  expect(response.flowStep.safeMessage).toBe(response.flowSummary.flowStep.safeMessage);
  expect(browserMocks.session.completion).toMatchObject({
    flowStep: { safeMessage: response.flowStep.safeMessage },
  });
}
