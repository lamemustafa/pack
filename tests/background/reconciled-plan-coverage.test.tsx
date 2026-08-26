import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";
import {
  createFullFiscalYearLedger,
  isFullFiscalYearLedger,
  unplannedEligibleFullFiscalYearPeriods,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
import {
  finishFullFiscalYearCleanup,
  markFullFiscalYearCleanupPending,
} from "../../src/background/filed-returns-full-fiscal-year-staging";
import { summariseFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-summary";
import { parseDurableFiledReturnsFlowSummary } from "../../src/background/filed-returns-durable-summary";
import { canonicalDurableSummaryMessage } from "../../src/connectors/gst/filed-returns-durable-status";
import { readCanonicalFiledReturnsFlowSummary } from "../../src/background/filed-returns-session-summary";
import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";
import { panelController } from "../panel/panel-controller.test-helpers";
import {
  makeCompletedRecoveryLedger,
  RECOVERY_NOW,
  RECOVERY_SCOPE,
} from "./full-year-completion-fixtures.test-helpers";

const mocks = vi.hoisted(() => {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const area = (values: Record<string, unknown>) => ({
    get: vi.fn(async () => structuredClone(values)),
    set: vi.fn(async (next: Record<string, unknown>) =>
      Object.assign(values, structuredClone(next)),
    ),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete values[key];
    }),
  });
  return {
    local,
    session,
    browser: { storage: { local: area(local), session: area(session) } },
    discard: vi.fn(async () => ["full-fiscal-year-opfs-cleared"]),
  };
});
vi.mock("wxt/browser", () => ({ browser: mocks.browser }));
vi.mock("../../src/background/filed-returns-full-fiscal-year-zip", () => ({
  discardFullFiscalYearFiledReturnsZip: mocks.discard,
}));

const marker = "full-fiscal-year-plan-narrower-than-eligible";
const deps: FiledReturnsFlowRunnerDeps = {
  getActiveGstTab: vi.fn(async () => null),
  sendMessageToTabWithInjection: vi.fn(),
  storageKeys: {
    completion: "coverage-summary",
    fullFiscalYearLedger: "coverage-ledger",
    observation: "coverage-observation",
  },
  now: () => RECOVERY_NOW,
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const values of [mocks.local, mocks.session]) {
    for (const key of Object.keys(values)) delete values[key];
  }
});

describe.each([
  ["confirmed ZIP", "downloaded", "downloaded-cleanup-pending", "Download complete"],
  ["no export", "not-filed", "no-artifacts-cleanup-pending", "No ZIP created"],
  ["unconfirmed ZIP", "downloaded", "legacy-cleanup-pending", "Periods processed, ZIP unconfirmed"],
] as const)("fixed-plan coverage after %s", (_outcome, targetStatus, phase, heading) => {
  it.each(["cleanup response", "durable reopen"] as const)(
    "preserves eligibility warning through %s and the panel",
    async (source) => {
      const fixture = makeCompletedRecoveryLedger(targetStatus);
      const fixed = createFullFiscalYearLedger(
        RECOVERY_SCOPE,
        new Date("2025-05-15T00:00:00.000Z"),
        ["April"],
      );
      const pending = markFullFiscalYearCleanupPending(
        { ...fixed, status: "complete", targets: [fixture.targets[0]!] },
        RECOVERY_NOW,
        phase,
      );
      expect(isFullFiscalYearLedger(pending)).toBe(true);
      expect(unplannedEligibleFullFiscalYearPeriods(pending, RECOVERY_NOW)).toHaveLength(11);
      const originalPlan = structuredClone(pending.targetPlan);
      const response = await finishFullFiscalYearCleanup(deps, pending);
      if (!response.ok || !("flowSummary" in response)) throw new Error("expected cleanup summary");
      const summary =
        source === "cleanup response"
          ? response.flowSummary
          : await readCanonicalFiledReturnsFlowSummary(deps.storageKeys.completion);
      expect(summary).not.toBeNull();
      if (!summary) throw new Error("expected durable cleanup summary");
      expect(
        summary.flowStep.safeSignals,
        "cleanup must retain the narrower-plan signal",
      ).toContain(marker);
      expect(summary.status).toBe("complete");
      expect(summary.totalPeriods).toBe(1);
      const saved = mocks.local[deps.storageKeys.fullFiscalYearLedger];
      expect(isFullFiscalYearLedger(saved)).toBe(true);
      if (!isFullFiscalYearLedger(saved)) throw new Error("expected canonical saved plan");
      expect(saved.targetPlan).toEqual(originalPlan);
      expect(saved.targets).toHaveLength(1);
      expect(summariseFullFiscalYearLedger(saved, RECOVERY_NOW).flowStep.safeSignals).toContain(
        marker,
      );
      const markup = renderToStaticMarkup(
        <PanelSurface
          pack={panelController({
            context: null,
            scope: summary.scope,
            scopedFlowSummary: summary,
            lastRunSummary: summary,
          })}
        />,
      );
      expect(markup).toContain(`aria-label="${heading}"`);
      expect(markup, "rendered completion must explain the narrower plan").toContain(
        "more periods are eligible now",
      );
      expect(deps.getActiveGstTab).not.toHaveBeenCalled();
      expect(deps.sendMessageToTabWithInjection).not.toHaveBeenCalled();
    },
  );
});

it.each([
  [
    "single period",
    { ...RECOVERY_SCOPE, period: "April" },
    "complete",
    ["filed-return-positively-not-filed"],
  ],
  ["blocked run", RECOVERY_SCOPE, "blocked", ["full-fiscal-year-run-needs-action"]],
  [
    "retained cleanup",
    RECOVERY_SCOPE,
    "blocked",
    ["full-fiscal-year-local-cleanup-retry", "full-fiscal-year-opfs-clear-failed"],
  ],
] as const)(
  "does not promote %s to a completed coverage claim",
  (_label, scope, status, signals) => {
    const safeSignals = [marker, ...signals];
    const message = canonicalDurableSummaryMessage(scope, status, safeSignals);
    expect(message).not.toContain("more periods are eligible now");
    const parsed = parseDurableFiledReturnsFlowSummary({
      scope,
      status,
      totalPeriods: 1,
      completedPeriods: status === "complete" ? ["April"] : [],
      ...(status === "complete" ? { currentPeriod: "April" } : {}),
      updatedAt: RECOVERY_NOW.toISOString(),
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: status === "complete" ? "candidate-not-found" : "blocked",
        safeSignals,
        safeMessage: message,
      },
    });
    expect(parsed?.status).toBe(status);
    expect(parsed?.flowStep.safeMessage).not.toContain("more periods are eligible now");
  },
);
