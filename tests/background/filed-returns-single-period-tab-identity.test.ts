import { beforeEach, describe, expect, it, vi } from "vitest";

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
  preflightSelectedArtifactsRecovery: vi.fn(async () => null),
  reconcileArtifactAcquisitionCheckpoint: vi.fn(async () => ({ state: "none" })),
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));
vi.mock("../../src/background/artifact-acquisition-state", () => ({
  reconcileArtifactAcquisitionCheckpoint: flowMocks.reconcileArtifactAcquisitionCheckpoint,
}));
vi.mock("../../src/background/filed-returns-selected-artifacts", () => ({
  preflightSelectedArtifactsRecovery: flowMocks.preflightSelectedArtifactsRecovery,
  triggerSelectedArtifacts: vi.fn(),
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
});

function deps() {
  return {
    getActiveGstTab: async () => ({
      id: 17,
      incognito: false,
      url: "not-a-supported-gst-tab",
    }),
    storageKeys: {
      completion: "completion",
      fullFiscalYearLedger: "ledger",
      observation: "observation",
    },
  } as never;
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
