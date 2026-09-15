import { beforeEach, describe, expect, it, vi } from "vitest";
import { readCurrentFiledReturnsFlowSummary } from "../../src/background/filed-returns-current-state";
import { parseDurableFiledReturnsFlowSummary } from "../../src/background/filed-returns-durable-summary";
import { parseDurableFiledReturnsSignals } from "../../src/connectors/gst/filed-returns-durable-signals";
import {
  createFullFiscalYearLedger,
  markFullFiscalYearTargetRunning,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
import {
  FULL_FISCAL_YEAR_PERIOD,
  getFiledReturnsFullFiscalYearPeriods,
} from "../../src/connectors/gst/filed-returns-scope";

const storage = vi.hoisted(() => ({
  local: {} as Record<string, unknown>,
  session: {} as Record<string, unknown>,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (key?: string | string[]) => {
          if (key === undefined) return { ...storage.local };
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.map((entry) => [entry, storage.local[entry]]));
        }),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage.local, values)),
      },
      session: {
        get: vi.fn(async (key: string) => ({ [key]: storage.session[key] })),
        remove: vi.fn(async (key: string) => {
          delete storage.session[key];
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(storage.session, values);
        }),
      },
    },
  },
}));

const deps = {
  storageKeys: {
    activeRun: "active-run",
    completion: "completion",
    fullFiscalYearLedger: "ledger",
    targetReview: "target-review",
  },
};

describe("durable filed-return current state", () => {
  beforeEach(() => {
    storage.local = {};
    storage.session = {};
  });

  it("reconstructs safe copy so a taxpayer-like persisted message never reaches the popup", async () => {
    storage.session.completion = singlePeriodSummary({
      safeMessage: "Synthetic Taxpayer GSTIN 00XXXXX0000X0Z0 needs action.",
    });

    const summary = await readCurrentFiledReturnsFlowSummary(deps);

    expect(summary).not.toBeNull();
    expect(summary?.flowStep.safeMessage).not.toContain("00XXXXX0000X0Z0");
    expect(summary?.flowStep.safeMessage).not.toContain("Synthetic Taxpayer");
    expect(JSON.stringify(storage.session.completion)).not.toContain("00XXXXX0000X0Z0");
    expect(JSON.stringify(storage.session.completion)).not.toContain("Synthetic Taxpayer");
  });

  it("rejects unknown, duplicate, excess, and structurally malformed session summaries", async () => {
    for (const summary of [
      singlePeriodSummary({ safeSignals: ["synthetic-portal-option-value"] }),
      singlePeriodSummary({
        safeSignals: ["browser-download-not-observed", "browser-download-not-observed"],
      }),
      { ...singlePeriodSummary(), portalHtml: "Synthetic Taxpayer" },
      singlePeriodSummary({ updatedAt: "2026-06-24" }),
      singlePeriodSummary({
        scope: {
          financialYear: "2025-26",
          period: "March",
          returnType: "GSTR-3B",
          portalOption: "00XXXXX0000X0Z0",
        },
      }),
    ]) {
      storage.session.completion = summary;
      await expect(readCurrentFiledReturnsFlowSummary(deps)).resolves.toBeNull();
      expect(storage.session.completion).toBeUndefined();
    }

    expect(parseDurableFiledReturnsSignals(EXACT_SIGNALS.slice(0, 32))).not.toBeNull();
    expect(parseDurableFiledReturnsSignals(EXACT_SIGNALS)).toBeNull();
  });

  it("accepts only canonical month and artifact parameter signals", () => {
    const parsed = parseDurableFiledReturnsFlowSummary({
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-1",
      },
      status: "partial",
      updatedAt: "2026-06-24T00:00:00.000Z",
      completedPeriods: [],
      currentPeriod: "May",
      totalPeriods: 1,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "downloaded",
        safeSignals: ["filed-return-artifact-downloaded:PDF", "filed-return-detail-period:May"],
        safeMessage: "Synthetic portal copy.",
      },
    });

    expect(parsed?.flowStep.safeSignals).toEqual([
      "filed-return-artifact-downloaded:PDF",
      "filed-return-detail-period:May",
    ]);
    expect(
      parseDurableFiledReturnsFlowSummary({
        ...singlePeriodSummary(),
        flowStep: {
          ...singlePeriodSummary().flowStep,
          safeSignals: ["filed-return-detail-period:SyntheticTaxpayer"],
        },
      }),
    ).toBeNull();
  });

  it("rejects a recovery payload that is not exactly bound to its current target", () => {
    const summary = {
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: "FULL_FISCAL_YEAR",
        returnType: "GSTR-2B",
      },
      status: "blocked",
      updatedAt: "2026-06-24T00:00:00.000Z",
      completedPeriods: [],
      currentPeriod: "March",
      totalPeriods: 12,
      fullFiscalYearRecovery: {
        ledgerId: "ledger-test",
        targetId: "GSTR-2B:2025-26:March:PDF_AND_EXCEL:foreign",
        expectedRevision: 2,
        targetStatus: "blocked",
      },
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-gstr2b-private-v0",
        state: "blocked",
        safeSignals: ["full-fiscal-year-run-needs-action"],
        safeMessage: "Needs action.",
      },
    };

    expect(parseDurableFiledReturnsFlowSummary(summary)).toBeNull();
  });

  it("does not trust aggregate full-year completion without its valid local ledger", async () => {
    storage.session.completion = {
      scope: {
        financialYear: "2025-26",
        period: "FULL_FISCAL_YEAR",
        returnType: "GSTR-3B",
      },
      status: "complete",
      completedAt: "2026-06-24T00:00:00.000Z",
      completedPeriods: ["April"],
      totalPeriods: 1,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded",
        safeSignals: ["full-fiscal-year-complete"],
        safeMessage: "Synthetic completion.",
      },
    };

    expect(parseDurableFiledReturnsFlowSummary(storage.session.completion)).not.toBeNull();
    await expect(readCurrentFiledReturnsFlowSummary(deps)).resolves.toBeNull();
  });

  // `isFullFiscalYearLedgerStale` decides "this run stopped" from ledger age alone, with no
  // reference to the run lease -- and 30s is shorter than a legitimate step, since the
  // content-message timeout alone is 60s. That predicate gives the wrong answer for a slow but
  // live run. It is safe here only because `readCurrentFiledReturnsFlowSummary` answers from the
  // active-run record first and never reaches the age branch while a lease exists.
  //
  // That ordering is load-bearing and was not guarded by anything. Replacing the early return
  // with `if (false && activeRunSummary)` makes the first test below report
  // `full-fiscal-year-run-interrupted` for a run whose lease was renewed this second -- "Pack
  // stopped before it could confirm the result for April", while it is working. So this pins the
  // invariant rather than the implementation: whatever the panel reads, it must not call a
  // leased run stopped.
  function staleRunningFullYearLedger(startedAt: Date) {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-1" as const,
    };
    const periods = getFiledReturnsFullFiscalYearPeriods(scope.financialYear, startedAt);
    const base = createFullFiscalYearLedger(scope, startedAt, periods);
    return markFullFiscalYearTargetRunning(base, base.targets[0]!.targetId, startedAt);
  }

  const RUN_STARTED_AT = new Date("2026-07-24T23:58:00.000Z");
  const NOW = new Date("2026-07-25T00:00:00.000Z");

  it("never reports a full-year run stopped while a live lease is behind it", async () => {
    storage.local.ledger = staleRunningFullYearLedger(RUN_STARTED_AT);
    // The lease a full-year run actually takes is scoped to the whole year, not to the month it
    // happens to be working on. Giving it `period: "April"` would make `sameFiledReturnsScope`
    // false and quietly test only the unmatched fallback.
    storage.local["active-run"] = {
      schemaVersion: "1.0",
      runId: "filed-returns-run-m0abc123",
      revision: 1,
      scope: {
        artifactType: "PDF",
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-1",
      },
      status: "running",
      leaseUpdatedAt: NOW.toISOString(),
    };

    const summary = await readCurrentFiledReturnsFlowSummary({ ...deps, now: () => NOW });

    expect(summary?.flowStep.safeSignals).not.toContain("full-fiscal-year-run-interrupted");
    expect(summary?.status).not.toBe("blocked");
  });

  it("reports a stale run interrupted once no lease is behind it", async () => {
    // The complement, and the reason the age predicate is not simply wrong: with no lease record
    // at all, age is the only evidence there is, and the interrupted view is the correct one.
    storage.local.ledger = staleRunningFullYearLedger(RUN_STARTED_AT);

    const summary = await readCurrentFiledReturnsFlowSummary({ ...deps, now: () => NOW });

    expect(summary?.flowStep.safeSignals).toContain("full-fiscal-year-run-interrupted");
  });
});

function singlePeriodSummary(overrides: Record<string, unknown> = {}) {
  const base = {
    scope: { financialYear: "2025-26", period: "March", returnType: "GSTR-3B" },
    status: "blocked",
    updatedAt: "2026-06-24T00:00:00.000Z",
    completedPeriods: [],
    currentPeriod: "March",
    totalPeriods: 1,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "blocked",
      safeSignals: ["browser-download-not-observed"],
      safeMessage: "Pack could not confirm the browser download.",
    },
  };
  const { safeMessage, safeSignals, ...summaryOverrides } = overrides;
  const flowOverrides = {
    ...(safeMessage !== undefined ? { safeMessage } : {}),
    ...(safeSignals !== undefined ? { safeSignals } : {}),
  };
  return {
    ...base,
    ...summaryOverrides,
    flowStep: { ...base.flowStep, ...flowOverrides },
  };
}

const EXACT_SIGNALS = [
  "browser-download-completed",
  "browser-download-correlation-rejected",
  "browser-download-created",
  "browser-download-danger-pending",
  "browser-download-danger-rejected",
  "browser-download-danger-unknown",
  "browser-download-existence-unknown",
  "browser-download-file-missing",
  "browser-download-interrupted",
  "browser-download-in-progress",
  "browser-download-non-empty",
  "browser-download-not-observed",
  "browser-download-save-dialog-may-be-open",
  "browser-download-search-missing",
  "browser-download-search-unavailable",
  "browser-download-size-unknown",
  "browser-download-state-unconfirmed",
  "browser-download-zero-bytes",
  "detail-summary-modal",
  "detail-summary-modal-close-blocked",
  "detail-summary-modal-close-clicked",
  "detail-summary-modal-close-control-not-found",
  "detail-summary-modal-dismissed",
  "detail-summary-modal-open",
  "filed-gstr1-controls-pending",
  "filed-gstr1-download-clicked",
  "filed-gstr1-download-status-not-filed",
  "filed-gstr1-download-trigger-ambiguous",
  "filed-gstr1-excel-control-pending",
  "filed-gstr1-excel-no-details-available",
  "filed-gstr1-result-view-auto-attempt-failed",
  "filed-gstr1-result-view-auto-clicked",
  "filed-gstr1-result-view-navigation-pending",
];
