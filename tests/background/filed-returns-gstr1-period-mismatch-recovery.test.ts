import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";
import { MAX_GSTR1_PERIOD_MISMATCH_RECOVERY_ATTEMPTS } from "../../src/background/filed-returns-gstr1-period-mismatch-recovery";
import {
  FILED_RETURN_ROUTE_MISMATCH_SIGNALS,
  GSTR1_PERIOD_MISMATCH_RECOVERY_STOPPED_SIGNAL,
  RETURN_TYPE_MISMATCH_RECOVERY_STOPPED_SIGNAL,
} from "../../src/connectors/gst/filed-returns-durable-signals";
import { gstr1PeriodMismatchRecoveryInstruction } from "../../src/connectors/gst/filed-returns-durable-status";
import { filedReturnScopeId } from "../../src/connectors/gst/filed-returns-return-descriptors";
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
        "return-dashboard-candidate-clicked",
        "filed-return-detail-period:June",
      ]),
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
    expect(deps.sendMessageToTabWithInjection).toHaveBeenCalledTimes(5);
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
    const responses = [
      step([
        "filed-gstr1-scope-switch-navigation",
        "return-dashboard-candidate-clicked",
        "filed-return-detail-period:June",
      ]),
      step([
        "filed-gstr1-scope-switch-navigation",
        "return-dashboard-candidate-clicked",
        "filed-return-detail-period:June",
      ]),
    ];
    const deps = createDeps(
      async () =>
        responses.shift() ??
        step([
          "filed-gstr1-scope-switch-navigation",
          "return-dashboard-candidate-clicked",
          "filed-return-detail-period:June",
        ]),
    );

    const response = await startSinglePeriodFiledReturnsDownloadFlow(SCOPE, deps);
    const instruction = gstr1PeriodMismatchRecoveryInstruction(SCOPE);

    expect(response).toMatchObject({
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining([
          "filed-gstr1-scope-switch-navigation",
          "filed-return-detail-period:June",
          GSTR1_PERIOD_MISMATCH_RECOVERY_STOPPED_SIGNAL,
        ]),
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          message: instruction,
          canResume: true,
        },
      },
    });
    if (!response.ok || !("flowStep" in response)) throw new Error("Expected a flow step.");
    expect(deps.sendMessageToTabWithInjection).toHaveBeenCalledTimes(
      MAX_GSTR1_PERIOD_MISMATCH_RECOVERY_ATTEMPTS + 1,
    );
    expect(response.flowStep.safeSignals).not.toContain("flow-step-limit-reached");
    expect(response.flowStep.safeMessage).toContain("June");
    expect(response.flowStep.safeMessage).toContain("April");
    expect(response.flowStep.safeMessage).toContain(instruction);
    expect(response.flowSummary?.flowStep.safeMessage).toContain("June");
    expect(response.flowSummary?.flowStep.safeMessage).toContain("April");
    expect(response.flowSummary?.flowStep.userAction).toEqual({
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: instruction,
      canResume: true,
    });
    expect(browserMocks.session.completion).toMatchObject({
      flowStep: {
        safeMessage: expect.stringContaining("June"),
      },
    });
    expect(JSON.stringify(browserMocks.session.completion)).toContain("April");
    expect(flowMocks.triggerSelectedArtifacts).not.toHaveBeenCalled();
  });

  it("persists a terminal stop when GSTR-2B-to-GSTR-1 navigation does not converge", async () => {
    const scope = SCOPE;
    const deps = createDeps(async () =>
      step(
        [FILED_RETURN_ROUTE_MISMATCH_SIGNALS["GSTR-2B"], "return-dashboard-candidate-clicked"],
        "clicked",
        "Pack is leaving the mismatched synthetic return page.",
        filedReturnScopeId(scope.returnType),
      ),
    );

    const response = await startSinglePeriodFiledReturnsDownloadFlow(scope, deps);

    expect(response).toMatchObject({
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining([
          FILED_RETURN_ROUTE_MISMATCH_SIGNALS["GSTR-2B"],
          RETURN_TYPE_MISMATCH_RECOVERY_STOPPED_SIGNAL,
        ]),
        userAction: { type: "NAVIGATE_TO_SUPPORTED_PAGE", canResume: true },
      },
    });
    if (!response.ok || !("flowStep" in response)) throw new Error("Expected a flow step.");
    expect(deps.sendMessageToTabWithInjection).toHaveBeenCalledTimes(
      MAX_GSTR1_PERIOD_MISMATCH_RECOVERY_ATTEMPTS + 1,
    );
    expect(response.flowStep.safeSignals).not.toContain("flow-step-limit-reached");
    expect(response.flowStep.safeMessage).toContain("GSTR-2B");
    expect(response.flowStep.safeMessage).toContain("GSTR-1");
    expect(browserMocks.session.completion).toMatchObject({
      flowStep: {
        state: "user-action-required",
        safeMessage: response.flowStep.safeMessage,
      },
    });
    expect(flowMocks.triggerSelectedArtifacts).not.toHaveBeenCalled();
  });

  it("keeps the unresolved mismatch action aligned with its terminal diagnosis", async () => {
    let calls = 0;
    const deps = createDeps(async () => {
      calls += 1;
      return step([
        "filed-gstr1-scope-switch-navigation",
        "return-dashboard-candidate-clicked",
        "filed-return-detail-period:June",
      ]);
    });

    const response = await startSinglePeriodFiledReturnsDownloadFlow(SCOPE, deps);

    if (!response.ok || !("flowStep" in response)) throw new Error("Expected a flow step.");
    const action = response.flowStep.userAction;
    const summaryAction = response.flowSummary?.flowStep.userAction;
    if (!action || !summaryAction) throw new Error("Expected matching recovery actions.");
    expect(calls).toBe(2);
    expect(action).toMatchObject({
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      canResume: true,
    });
    expect(response.flowStep.safeMessage).toContain(action.message);
    expect(summaryAction).toMatchObject({
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      canResume: true,
    });
    expect(response.flowSummary?.flowStep.safeMessage).toContain(summaryAction.message);
    expect(flowMocks.triggerSelectedArtifacts).not.toHaveBeenCalled();
  });

  it("preserves a higher-priority portal availability diagnosis after mismatch navigation", async () => {
    const responses: PackMessageResponse[] = [
      step([
        "filed-gstr1-scope-switch-navigation",
        "return-dashboard-candidate-clicked",
        "filed-return-detail-period:June",
      ]),
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "blocked",
          safeSignals: ["portal-system-error"],
          safeMessage:
            "The GST portal returned a system-error page. Return to an authenticated GST page and retry this period.",
          userAction: {
            type: "WAIT_FOR_PORTAL_AVAILABILITY",
            message: "Return after the portal system error clears.",
            canResume: true,
          },
        },
      },
    ];
    const deps = createDeps(async () => responses.shift() ?? step([], "user-action-required"));

    const response = await startSinglePeriodFiledReturnsDownloadFlow(SCOPE, deps);
    if (!response.ok || !("flowStep" in response)) throw new Error("Expected a flow step.");

    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: ["portal-system-error"],
        userAction: { type: "WAIT_FOR_PORTAL_AVAILABILITY", canResume: true },
      },
      flowSummary: {
        flowStep: {
          safeSignals: ["portal-system-error"],
          userAction: { type: "WAIT_FOR_PORTAL_AVAILABILITY", canResume: true },
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain(GSTR1_PERIOD_MISMATCH_RECOVERY_STOPPED_SIGNAL);
    expect(flowMocks.triggerSelectedArtifacts).not.toHaveBeenCalled();
  });

  it("keeps the deliberate stop signal ahead of the durable signal cap", async () => {
    const fillerSignals = [
      "filed-return-detail-back-clicked",
      "filed-return-detail-period-unverified",
      "filed-return-detail-type-missing",
      "filed-return-filter-selection-in-progress",
      "filed-return-filters-selected",
      "filed-return-result-view-clicked",
      "filed-return-results-visible",
      "filed-return-search-results-pending",
      "filed-returns-candidate-clicked",
      "filed-returns-heading",
      "filed-returns-page-settling",
      "filed-returns-route",
      "financial-year-selected",
      "gstr1-dashboard-period-select-found",
      "gstr1-dashboard-quarter-select-found",
      "gstr1-dashboard-root-found",
      "gstr1-dashboard-search-found",
      "gstr1-dashboard-year-select-found",
      "gstr1-dashboard-view-clicked",
      "gstr1-return-dashboard-filter-selection-in-progress",
      "gstr1-return-dashboard-filters-selected",
      "gstr1-return-dashboard-route",
      "gstr1-return-dashboard-search-results-pending",
      "month-selected",
      "period-selected",
      "return-dashboard-candidate-clicked",
      "return-dashboard-initial-scan",
      "return-type-selected",
      "search-clicked",
      "status-filed",
    ];
    const responses = [
      step([
        "filed-gstr1-scope-switch-navigation",
        "return-dashboard-candidate-clicked",
        "filed-return-detail-period:June",
      ]),
      step([
        ...fillerSignals,
        "filed-gstr1-scope-switch-navigation",
        "filed-return-detail-period:June",
      ]),
    ];
    const deps = createDeps(async () => responses.shift() ?? step([], "user-action-required"));

    const response = await startSinglePeriodFiledReturnsDownloadFlow(SCOPE, deps);
    if (!response.ok || !("flowStep" in response)) throw new Error("Expected a flow step.");

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          GSTR1_PERIOD_MISMATCH_RECOVERY_STOPPED_SIGNAL,
          "filed-gstr1-scope-switch-navigation",
          "filed-return-detail-period:June",
        ]),
      },
      flowSummary: {
        flowStep: {
          safeSignals: expect.arrayContaining([GSTR1_PERIOD_MISMATCH_RECOVERY_STOPPED_SIGNAL]),
        },
      },
    });
    expect(response.flowSummary?.flowStep.safeSignals).toHaveLength(32);
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
    expect(response.flowStep.userAction).toEqual({
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: gstr1PeriodMismatchRecoveryInstruction(SCOPE),
      canResume: true,
    });
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
          GSTR1_PERIOD_MISMATCH_RECOVERY_STOPPED_SIGNAL,
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
  let elapsedMs = 0;
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
    now: () => {
      elapsedMs += 100;
      return new Date(
        `2026-06-24T00:00:${String(Math.floor(elapsedMs / 1_000)).padStart(2, "0")}.000Z`,
      );
    },
  };
}

function step(
  safeSignals: string[],
  state: "clicked" | "ready" | "user-action-required" = "clicked",
  safeMessage = "Pack is continuing the synthetic GSTR-1 flow.",
  scopeId = "gst-filed-returns-gstr1-pdf-private-v0",
): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId,
      state,
      safeSignals,
      safeMessage,
    },
  };
}
