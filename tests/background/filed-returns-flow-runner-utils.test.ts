import { describe, expect, it } from "vitest";
import type { PortalFlowStepResult } from "../../src/core/contracts";
import {
  DETAIL_SUMMARY_MODAL_SETTLE_MS,
  FLOW_STEP_SETTLE_MS,
  RESULT_ROW_NAVIGATION_SETTLE_MS,
  getFlowStepSettleMs,
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

  it("uses the generic continuation settle for non-navigation steps", () => {
    expect(getFlowStepSettleMs(BASE_STEP, BASE_DEPS)).toBe(FLOW_STEP_SETTLE_MS);
  });

  it("keeps test/runtime timing overrides explicit", () => {
    const deps = {
      ...BASE_DEPS,
      timings: {
        detailSummaryModalSettleMs: 1,
        flowStepSettleMs: 2,
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
          safeSignals: ["filed-return-api-result-posted"],
        },
        deps,
      ),
    ).toBe(3);
  });
});
