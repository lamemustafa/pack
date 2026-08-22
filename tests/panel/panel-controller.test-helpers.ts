import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { panelPresets, type PanelPreset } from "../../src/entrypoints/panel/panel-presets";
import type { PackPanelController } from "../../src/entrypoints/panel/panel-surface";

/** The GSTR-3B whole-year preset, as produced by the module the panel itself calls. */
export const FIRST_PANEL_PRESET = panelPresets()[0] as PanelPreset;

/**
 * A controller in the state the panel treats as "nothing has happened yet". Shared by every
 * panel test so a field added to the controller cannot be stubbed two different ways.
 */
export function panelController(overrides: Partial<PackPanelController> = {}): PackPanelController {
  return {
    acknowledgeInterruptedRun: async () => undefined,
    actionError: null,
    completionStatus: null,
    context: { connectorId: "gst", pageKind: "gst-filed-returns", supported: true },
    effectiveBusy: null,
    filedReturnsObservation: null,
    lastRunSummary: null,
    recoverySummary: null,
    refreshPortalContext: async () => undefined,
    resolveFullFiscalYearTarget: async () => undefined,
    resolveUnconfirmedDownload: async () => undefined,
    retryFiledReturnsTarget: async () => undefined,
    retryFullFiscalYearTarget: async () => undefined,
    scope: FIRST_PANEL_PRESET.scope,
    scopeLockedForReview: false,
    scopedFlowSummary: null,
    setScope: () => undefined,
    startFiledReturnsFlow: async () => undefined,
    startFreshFiledReturnsFlow: async () => undefined,
    status: "GST context detected.",
    summaryHeading: null,
    ...overrides,
  };
}

/** A completed whole-year run for the first preset's own scope. */
export function completedPanelSummary(
  overrides: Partial<FiledReturnsFlowSummary> = {},
): FiledReturnsFlowSummary {
  return {
    scope: FIRST_PANEL_PRESET.scope,
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
