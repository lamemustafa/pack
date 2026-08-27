import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import type { PackPanelController } from "../../src/entrypoints/panel/panel-surface";

/** Stable synthetic scope for panel rendering; production options come from the catalogue. */
export const PANEL_TEST_SCOPE = {
  financialYear: "2025-26",
  period: FULL_FISCAL_YEAR_PERIOD,
  returnType: "GSTR-3B",
  artifactType: "PDF",
} as const;

/**
 * A controller in the state the panel treats as "nothing has happened yet". Shared by every
 * panel test so a field added to the controller cannot be stubbed two different ways.
 */
export function panelController(overrides: Partial<PackPanelController> = {}): PackPanelController {
  return {
    acknowledgeInterruptedRun: async () => undefined,
    actionError: null,
    context: { connectorId: "gst", pageKind: "gst-filed-returns", supported: true },
    effectiveBusy: null,
    lastRunSummary: null,
    recoverySummary: null,
    refreshFlowSummary: async () => undefined,
    refreshPortalContext: async () => undefined,
    resolveFullFiscalYearTarget: async () => undefined,
    resolveUnconfirmedDownload: async () => undefined,
    retryFiledReturnsTarget: async () => undefined,
    retryFullFiscalYearTarget: async () => undefined,
    scope: PANEL_TEST_SCOPE,
    scopeLockedForReview: false,
    scopedFlowSummary: null,
    setScope: () => undefined,
    startFiledReturnsFlow: async () => undefined,
    startFreshFiledReturnsFlow: async () => undefined,
    ...overrides,
  };
}

/** A completed whole-year run for the panel's synthetic scope. */
export function completedPanelSummary(
  overrides: Partial<FiledReturnsFlowSummary> = {},
): FiledReturnsFlowSummary {
  return {
    scope: PANEL_TEST_SCOPE,
    status: "complete",
    completedPeriods: ["April", "May"],
    totalPeriods: 2,
    updatedAt: "2026-08-21T00:00:00.000Z",
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "downloaded",
      safeSignals: ["full-fiscal-year-zip-downloaded"],
      safeMessage: "Pack saved the fiscal-year ZIP through your browser.",
    },
    ...overrides,
  };
}
