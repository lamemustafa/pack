import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async (key?: unknown) => {
        if (typeof key === "string") return { [key]: stored.current[key] };
        return stored.current;
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete stored.current[key];
      }),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(stored.current, values);
      }),
    },
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));

import {
  hasTerminalPositiveTarget,
  persistLedger,
  readPlanLedgersStorageState,
} from "../../src/background/filed-returns-full-fiscal-year-run-state";
import {
  createFullFiscalYearLedger,
  markFullFiscalYearTargetRunning,
  markFullFiscalYearTargetTerminal,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { exportFullFiscalYearZip } from "../../src/background/filed-returns-full-fiscal-year-zip";
import { targetStatusFromFlowStep } from "../../src/background/filed-returns-full-fiscal-year-summary";
import { isFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-validation";
import type { FiledReturnsDownloadScope } from "../../src/connectors/gst/filed-returns-contracts";

const deps = {
  storageKeys: { fullFiscalYearLedger: "legacy", fullFiscalYearLedgerIndex: "index" },
};

const scope: FiledReturnsDownloadScope = {
  financialYear: "2025-26",
  period: "FULL_FISCAL_YEAR",
  returnType: "GSTR-3B",
  artifactType: "PDF",
};

// Live 2026-09-22: for a quarterly (QRMP) taxpayer the filed-return search answered "no record" for
// April and May and the role status answered userPref "Q" for each. No GSTR-3B exists for months 1-2
// of a quarter, so the year must neither call them not filed nor stop at them.
function quarterlyMonthStep() {
  return {
    connectorId: "gst" as const,
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "candidate-not-found" as const,
    safeSignals: ["filed-return-api-searched", "filed-gstr3b-quarterly-no-monthly-return"],
    safeMessage:
      "The GST Portal shows this taxpayer files GSTR-3B quarterly (QRMP) for April 2025-26.",
  };
}

describe("a full-year GSTR-3B run for a quarterly filer's months 1-2", () => {
  beforeEach(() => {
    stored.current = {};
    vi.clearAllMocks();
  });

  it("settles the month with its own status, and reads the saved plan back", async () => {
    const now = new Date("2026-09-25T00:00:00.000Z");
    expect(targetStatusFromFlowStep(quarterlyMonthStep(), "GSTR-3B")).toBe(
      "quarterly-no-monthly-return",
    );
    let ledger = createFullFiscalYearLedger(scope, now, ["April", "May"]);
    const april = ledger.targets[0]!.targetId;
    ledger = markFullFiscalYearTargetRunning(ledger, april, now);
    await persistLedger(deps, ledger);

    ledger = markFullFiscalYearTargetTerminal(
      ledger,
      april,
      "quarterly-no-monthly-return",
      quarterlyMonthStep(),
      now,
    );

    expect(ledger.targets[0]!.status).toBe("quarterly-no-monthly-return");
    expect(ledger.targets[0]!.safeMessage).toMatch(/quarterly/i);
    expect(ledger.targets[0]!.safeMessage).not.toMatch(/not filed|no filed|Check Downloads/i);
    await persistLedger(deps, ledger);
    expect(await readPlanLedgersStorageState(deps)).toMatchObject({ state: "valid" });
    expect(hasTerminalPositiveTarget(ledger)).toBe(true);
  });

  it("rejects a stored month claiming the status without its evidence", () => {
    const ledger = createFullFiscalYearLedger(scope, new Date("2026-09-25T00:00:00.000Z"), [
      "April",
    ]);
    ledger.targets[0] = {
      ...ledger.targets[0]!,
      status: "quarterly-no-monthly-return",
      safeSignals: ["filed-return-api-searched"],
    };
    expect(isFullFiscalYearLedger(ledger)).toBe(false);
  });

  it("does not block the year's ZIP on a month that has no return", async () => {
    const now = new Date("2026-09-25T00:00:00.000Z");
    let ledger = createFullFiscalYearLedger(scope, now, ["April"]);
    const april = ledger.targets[0]!.targetId;
    ledger = markFullFiscalYearTargetRunning(ledger, april, now);
    ledger = markFullFiscalYearTargetTerminal(
      ledger,
      april,
      "quarterly-no-monthly-return",
      quarterlyMonthStep(),
      now,
    );

    const step = await exportFullFiscalYearZip(ledger, {
      connectorId: "gst" as const,
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "downloaded" as const,
      safeSignals: ["full-fiscal-year-complete"],
      safeMessage: "Pack completed the local full fiscal year run.",
    });

    expect(step.safeSignals).not.toContain("full-fiscal-year-zip-artifact-staging-incomplete");
    expect(step.safeSignals).toContain("full-fiscal-year-no-zip-artifacts");
    expect(step.state).not.toBe("blocked");
  });
});
