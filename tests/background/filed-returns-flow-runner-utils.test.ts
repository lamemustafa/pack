import { describe, expect, it } from "vitest";
import type { PortalFlowStepResult } from "../../src/core/contracts";
import {
  DETAIL_SUMMARY_MODAL_SETTLE_MS,
  FLOW_STEP_SETTLE_MS,
  MAX_GSTR1_FLOW_STEPS,
  MAX_GSTR3B_FLOW_STEPS,
  PORTAL_NAVIGATION_SETTLE_MS,
  RESULT_ROW_NAVIGATION_SETTLE_MS,
  getFlowStepSettleMs,
  maxFlowStepsFor,
  shouldContinueFlow,
} from "../../src/background/filed-returns-flow-runner-utils";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";

const BASE_STEP: PortalFlowStepResult = {
  connectorId: "gst",
  scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
  state: "clicked",
  safeSignals: [],
  safeMessage: "Step.",
};

const BASE_DEPS: FiledReturnsFlowRunnerDeps = {
  getActiveGstTab: async () => null,
  sendMessageToTabWithInjection: async () => ({ ok: false, error: "not-used" }),
  storageKeys: {
    completion: "completion",
    fullFiscalYearLedger: "ledger",
    observation: "observation",
  },
};

describe("filed returns flow runner wait policy", () => {
  it("keeps the longer settle only for portal result-to-detail navigation", () => {
    expect(
      getFlowStepSettleMs(
        {
          ...BASE_STEP,
          safeSignals: ["filed-return-result-view-clicked"],
        },
        BASE_DEPS,
      ),
    ).toBe(RESULT_ROW_NAVIGATION_SETTLE_MS);

    expect(
      getFlowStepSettleMs(
        {
          ...BASE_STEP,
          safeSignals: ["gstr2b-dashboard-view-clicked"],
        },
        BASE_DEPS,
      ),
    ).toBe(RESULT_ROW_NAVIGATION_SETTLE_MS);
  });

  it("uses a short settle after summary modal dismissal", () => {
    expect(
      getFlowStepSettleMs(
        {
          ...BASE_STEP,
          safeSignals: ["detail-summary-modal"],
        },
        BASE_DEPS,
      ),
    ).toBe(DETAIL_SUMMARY_MODAL_SETTLE_MS);
  });

  it("does not auto-retry after the portal keeps its summary overlay open", () => {
    expect(
      shouldContinueFlow({
        ...BASE_STEP,
        state: "blocked",
        safeSignals: ["detail-summary-modal", "detail-summary-modal-close-blocked"],
      }),
    ).toBe(false);
  });

  it("waits for top-level GST navigation to settle before probing again", () => {
    expect(
      getFlowStepSettleMs(
        {
          ...BASE_STEP,
          safeSignals: ["filed-returns-candidate-clicked"],
        },
        BASE_DEPS,
      ),
    ).toBe(PORTAL_NAVIGATION_SETTLE_MS);

    expect(
      getFlowStepSettleMs(
        {
          ...BASE_STEP,
          safeSignals: ["return-dashboard-candidate-clicked"],
        },
        BASE_DEPS,
      ),
    ).toBe(PORTAL_NAVIGATION_SETTLE_MS);

    expect(
      getFlowStepSettleMs(
        {
          ...BASE_STEP,
          safeSignals: ["filed-returns-page-settling"],
        },
        BASE_DEPS,
      ),
    ).toBe(PORTAL_NAVIGATION_SETTLE_MS);

    for (const safeSignal of [
      "filed-return-detail-back-clicked",
      "filed-gstr1-summary-back-clicked",
    ]) {
      expect(
        getFlowStepSettleMs(
          {
            ...BASE_STEP,
            safeSignals: [safeSignal],
          },
          BASE_DEPS,
        ),
      ).toBe(PORTAL_NAVIGATION_SETTLE_MS);
    }

    for (const safeSignal of ["search-clicked", "filed-return-search-results-pending"]) {
      expect(
        getFlowStepSettleMs(
          {
            ...BASE_STEP,
            safeSignals: [safeSignal],
          },
          BASE_DEPS,
        ),
      ).toBe(PORTAL_NAVIGATION_SETTLE_MS);
    }

    expect(
      getFlowStepSettleMs(
        {
          ...BASE_STEP,
          safeSignals: ["filed-gstr1-excel-control-pending"],
        },
        BASE_DEPS,
      ),
    ).toBe(PORTAL_NAVIGATION_SETTLE_MS);

    expect(
      getFlowStepSettleMs(
        {
          ...BASE_STEP,
          safeSignals: ["filed-gstr1-controls-pending"],
        },
        BASE_DEPS,
      ),
    ).toBe(PORTAL_NAVIGATION_SETTLE_MS);
  });

  it("uses the generic continuation settle for non-navigation steps", () => {
    expect(getFlowStepSettleMs(BASE_STEP, BASE_DEPS)).toBe(FLOW_STEP_SETTLE_MS);
  });

  it("keeps GSTR-2B dashboard result polling on the generic cadence", () => {
    expect(
      getFlowStepSettleMs(
        {
          ...BASE_STEP,
          safeSignals: ["gstr2b-return-dashboard-search-results-pending"],
        },
        BASE_DEPS,
      ),
    ).toBe(FLOW_STEP_SETTLE_MS);
  });

  it("gives a fresh-login GSTR-3B flow the same bounded navigation budget as other returns", () => {
    expect(
      maxFlowStepsFor({
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      }),
    ).toBe(MAX_GSTR3B_FLOW_STEPS);
    expect(MAX_GSTR3B_FLOW_STEPS).toBe(12);
  });

  it("allows GSTR-1 search results the full ordinary observation window", () => {
    expect(
      maxFlowStepsFor({
        financialYear: "2025-26",
        period: "April",
        returnType: "GSTR-1",
      }),
    ).toBe(MAX_GSTR1_FLOW_STEPS);
    expect(MAX_GSTR1_FLOW_STEPS).toBe(30);
  });

  it("keeps test/runtime timing overrides explicit", () => {
    const deps = {
      ...BASE_DEPS,
      timings: {
        detailSummaryModalSettleMs: 1,
        flowStepSettleMs: 2,
        portalNavigationSettleMs: 4,
        resultRowNavigationSettleMs: 3,
      },
    };

    expect(
      getFlowStepSettleMs(
        {
          ...BASE_STEP,
          safeSignals: ["detail-summary-modal"],
        },
        deps,
      ),
    ).toBe(1);
    expect(getFlowStepSettleMs(BASE_STEP, deps)).toBe(2);
    expect(
      getFlowStepSettleMs(
        {
          ...BASE_STEP,
          safeSignals: ["filed-returns-candidate-clicked"],
        },
        deps,
      ),
    ).toBe(4);
    expect(
      getFlowStepSettleMs(
        {
          ...BASE_STEP,
          safeSignals: ["filed-return-api-result-posted"],
        },
        deps,
      ),
    ).toBe(3);
  });
});
