import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";
import type { PackMessageResponse } from "../../src/connectors/gst/messages";

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
  tabs: { update: vi.fn(async () => undefined) },
  windows: { update: vi.fn(async () => undefined) },
}));
const flowMocks = vi.hoisted(() => ({
  preflightSelectedArtifactsRecovery: vi.fn(async () => null),
  triggerSelectedArtifacts: vi.fn(async () => ({
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "downloaded",
      safeSignals: ["filed-return-artifact-downloaded:PDF"],
      safeMessage: "Pack downloaded the requested GSTR-1 PDF.",
    },
  })),
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));
vi.mock("../../src/background/filed-returns-selected-artifacts", () => flowMocks);

import { startSinglePeriodFiledReturnsDownloadFlow } from "../../src/background/filed-returns-single-period-flow";

const SCOPE = {
  artifactType: "PDF" as const,
  financialYear: "2025-26",
  period: "April",
  returnType: "GSTR-1" as const,
};

describe("GSTR-1 period-mismatch recovery", () => {
  beforeEach(() => {
    browserMocks.session = {};
    vi.clearAllMocks();
    flowMocks.preflightSelectedArtifactsRecovery.mockResolvedValue(null);
  });

  it("continues through a transitional generic page and reaches the requested period", async () => {
    const responses = [
      step([
        "filed-gstr1-scope-switch-navigation",
        "filed-returns-candidate-clicked",
        "filed-return-detail-period:June",
      ]),
      step(
        ["filed-returns-heading", "view-action", "search-action", "filed"],
        "user-action-required",
        "The filed returns page is visible, but the requested return type is not visible yet.",
      ),
      step(["gstr1-filed-returns-route-mismatched", "return-dashboard-candidate-clicked"]),
      step(["gstr1-return-dashboard-filter-selection-in-progress", "period-selected"]),
      step(["gstr1-return-dashboard-search-results-pending"]),
      step(["gstr1-dashboard-view-clicked"]),
      step(
        [
          "filed-return-download-ready",
          "filed-gstr1-download-ready",
          "filed-return-detail-period:April",
          "filed-return-detail-financial-year:2025-26",
        ],
        "ready",
      ),
    ];
    const deps = createDeps(async () => responses.shift() ?? step([], "user-action-required"));

    const response = await startSinglePeriodFiledReturnsDownloadFlow(SCOPE, deps, {
      persistSinglePeriodSummary: false,
    });

    expect(response).toMatchObject({ flowStep: { state: "downloaded" } });
    expect(deps.sendMessageToTabWithInjection).toHaveBeenCalledTimes(7);
    for (const [, message] of vi.mocked(deps.sendMessageToTabWithInjection).mock.calls) {
      expect(message).toMatchObject({
        type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
        payload: SCOPE,
      });
    }
    expect(flowMocks.triggerSelectedArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        activeFinancialYear: "2025-26",
        activePeriod: "April",
        scope: SCOPE,
        tabId: 17,
      }),
    );
  });

  it("names the visible and requested periods when recovery exhausts its bounded attempts", async () => {
    let calls = 0;
    const deps = createDeps(async () => {
      calls += 1;
      if (calls === 1) {
        return step([
          "filed-gstr1-scope-switch-navigation",
          "filed-returns-candidate-clicked",
          "filed-return-detail-period:June",
        ]);
      }
      return step(
        ["filed-returns-heading", "view-action", "search-action", "filed"],
        "user-action-required",
        "The filed returns page is visible, but the requested return type is not visible yet.",
      );
    });

    const response = await startSinglePeriodFiledReturnsDownloadFlow(SCOPE, deps);

    expect(response).toMatchObject({
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining([
          "filed-gstr1-scope-switch-navigation",
          "filed-return-detail-period:June",
          "flow-step-limit-reached",
        ]),
      },
    });
    if (!response.ok || !("flowStep" in response)) throw new Error("Expected a flow step.");
    expect(response.flowStep.safeMessage).toContain("June");
    expect(response.flowStep.safeMessage).toContain("April");
    expect(response.flowSummary?.flowStep.safeMessage).toContain("June");
    expect(response.flowSummary?.flowStep.safeMessage).toContain("April");
    expect(browserMocks.session.completion).toMatchObject({
      flowStep: {
        safeMessage: expect.stringContaining("June"),
      },
    });
    expect(JSON.stringify(browserMocks.session.completion)).toContain("April");
    expect(flowMocks.triggerSelectedArtifacts).not.toHaveBeenCalled();
  });

  it("retains mismatch context when detail readiness exhausts after dashboard View", async () => {
    const responses = [
      step([
        "filed-gstr1-scope-switch-navigation",
        "filed-returns-candidate-clicked",
        "filed-return-detail-period:June",
      ]),
      step(["gstr1-filed-returns-route-mismatched", "return-dashboard-candidate-clicked"]),
      step(["gstr1-dashboard-view-clicked"]),
    ];
    const deps = createDeps(async () => {
      const response = responses.shift();
      return (
        response ??
        step(
          ["filed-returns-heading", "view-action", "search-action", "filed"],
          "user-action-required",
          "The filed returns page is visible, but the requested return type is not visible yet.",
        )
      );
    });

    const response = await startSinglePeriodFiledReturnsDownloadFlow(SCOPE, deps);

    expect(response).toMatchObject({
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining([
          "filed-gstr1-scope-switch-navigation",
          "filed-return-detail-period:June",
        ]),
      },
      flowSummary: {
        flowStep: {
          safeMessage: expect.stringContaining("June"),
        },
      },
    });
    if (!response.ok || !("flowStep" in response)) throw new Error("Expected a flow step.");
    expect(response.flowStep.safeMessage).toContain("April");
    expect(response.flowSummary?.flowStep.safeMessage).toContain("April");
    expect(JSON.stringify(browserMocks.session.completion)).toContain("June");
    expect(JSON.stringify(browserMocks.session.completion)).toContain("April");
    expect(flowMocks.triggerSelectedArtifacts).not.toHaveBeenCalled();
  });

  it("does not retain or render a malformed period signal suffix", async () => {
    const malformedPeriod = "SyntheticMarker";
    let calls = 0;
    const deps = createDeps(async () => {
      calls += 1;
      return calls === 1
        ? step([
            "filed-gstr1-scope-switch-navigation",
            `filed-return-detail-period:${malformedPeriod}`,
          ])
        : step(
            ["filed-returns-heading", "view-action", "search-action", "filed"],
            "user-action-required",
          );
    });

    const response = await startSinglePeriodFiledReturnsDownloadFlow(SCOPE, deps);

    expect(JSON.stringify(response)).not.toContain(malformedPeriod);
    expect(JSON.stringify(browserMocks.session.completion) ?? "").not.toContain(malformedPeriod);
    expect(flowMocks.triggerSelectedArtifacts).not.toHaveBeenCalled();
  });

  it("persists only the latest canonical mismatched period", async () => {
    let calls = 0;
    const deps = createDeps(async () => {
      calls += 1;
      if (calls === 1) {
        return step(["filed-gstr1-scope-switch-navigation", "filed-return-detail-period:June"]);
      }
      if (calls === 2) {
        return step(["filed-gstr1-summary-period-mismatch", "filed-return-detail-period:May"]);
      }
      return step(
        ["filed-returns-heading", "view-action", "search-action", "filed"],
        "user-action-required",
      );
    });

    const response = await startSinglePeriodFiledReturnsDownloadFlow(SCOPE, deps);

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "filed-gstr1-scope-switch-navigation",
          "filed-gstr1-summary-period-mismatch",
          "filed-return-detail-period:May",
        ]),
        safeMessage: expect.stringContaining("May"),
      },
      flowSummary: {
        flowStep: { safeMessage: expect.stringContaining("May") },
      },
    });
    expect(JSON.stringify(response)).not.toContain("page showing June");
    expect(JSON.stringify(browserMocks.session.completion)).toContain("page showing May");
    expect(JSON.stringify(browserMocks.session.completion)).not.toContain("page showing June");
  });
});

function createDeps(sendMessage: () => Promise<PackMessageResponse>): FiledReturnsFlowRunnerDeps {
  return {
    getActiveGstTab: async () =>
      ({
        id: 17,
        incognito: false,
        url: "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum",
      }) as Awaited<ReturnType<FiledReturnsFlowRunnerDeps["getActiveGstTab"]>>,
    sendMessageToTabWithInjection: vi.fn(sendMessage),
    storageKeys: {
      completion: "completion",
      fullFiscalYearLedger: "ledger",
      observation: "observation",
    },
    timings: {
      flowStepSettleMs: 0,
      portalNavigationSettleMs: 0,
      resultRowNavigationSettleMs: 0,
    },
  };
}

function step(
  safeSignals: string[],
  state: "clicked" | "ready" | "user-action-required" = "clicked",
  safeMessage = "Pack is continuing the synthetic GSTR-1 flow.",
): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state,
      safeSignals,
      safeMessage,
    },
  };
}
