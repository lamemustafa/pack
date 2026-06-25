import { describe, expect, it } from "vitest";
import {
  FULL_FISCAL_YEAR_PERIOD,
  type FiledReturnsMonth,
} from "../../src/core/filed-returns-scope";
import type { FiledReturnsFullFiscalYearLedger } from "../../src/core/contracts";
import {
  isFullFiscalYearLedger,
  nextRunnableFullFiscalYearTarget,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
import {
  summariseFullFiscalYearLedger,
  targetStatusFromFlowStep,
} from "../../src/background/filed-returns-full-fiscal-year";

describe("full fiscal year ledger", () => {
  it("does not select later targets while an unconfirmed download needs acknowledgement", () => {
    const ledger = createLedger([
      ["April", "download-unconfirmed"],
      ["May", "pending"],
    ]);

    expect(nextRunnableFullFiscalYearTarget(ledger)).toBeNull();
  });

  it("selects only pending targets for normal scheduling", () => {
    expect(nextRunnableFullFiscalYearTarget(createLedger([["April", "pending"]]))).toMatchObject({
      period: "April",
      status: "pending",
    });

    for (const status of ["blocked", "failed", "cancelled"] as const) {
      expect(nextRunnableFullFiscalYearTarget(createLedger([["April", status]]))).toBeNull();
    }
  });

  it("summarises saved pending running ledgers as explicit resume confirmation", () => {
    const summary = summariseFullFiscalYearLedger({
      ...createLedger([
        ["April", "downloaded"],
        ["May", "pending"],
      ]),
      status: "running",
      currentTargetId: "GSTR-3B:2026-27:May",
    });

    expect(summary).toMatchObject({
      status: "running",
      currentPeriod: "May",
      fullFiscalYearRecovery: {
        targetId: "GSTR-3B:2026-27:May",
        targetStatus: "pending",
      },
      flowStep: {
        state: "blocked",
        safeSignals: ["full-fiscal-year-resume-confirmation-required"],
      },
    });
    expect(summary.flowStep.safeSignals).not.toContain("full-fiscal-year-run-active");
  });

  it("maps only positive not-filed evidence to a terminal not-filed target", () => {
    expect(
      targetStatusFromFlowStep({
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "candidate-not-found",
        safeSignals: ["filed-return-positively-not-filed"],
        safeMessage: "No filed return exists for the selected period.",
      }),
    ).toBe("not-filed");

    expect(
      targetStatusFromFlowStep({
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "candidate-not-found",
        safeSignals: ["filed-return-result-row-not-found"],
        safeMessage: "Missing result row.",
      }),
    ).toBe("blocked");
  });

  it("rejects malformed or inconsistent persisted ledgers", () => {
    expect(isFullFiscalYearLedger(createLedger([["April", "downloaded"]]))).toBe(true);

    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        status: "surprise",
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        targets: [
          { ...createTarget("April", "downloaded") },
          { ...createTarget("April", "pending") },
        ],
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        targets: [{ ...createTarget("April", "downloaded"), financialYear: "2025-26" }],
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        targets: [{ ...createTarget("April", "downloaded"), status: "unknown" }],
      }),
    ).toBe(false);
  });
});

function createLedger(
  targets: Array<
    [FiledReturnsMonth, FiledReturnsFullFiscalYearLedger["targets"][number]["status"]]
  >,
): FiledReturnsFullFiscalYearLedger {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    schemaVersion: "1.0",
    ledgerId: "ledger-test",
    status: "blocked",
    scope: {
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    },
    ...(targets[0] ? { currentTargetId: `GSTR-3B:2026-27:${targets[0][0]}` } : {}),
    createdAt: now,
    updatedAt: now,
    targets: targets.map(([period, status]) => createTarget(period, status)),
  };
}

function createTarget(
  period: FiledReturnsMonth,
  status: FiledReturnsFullFiscalYearLedger["targets"][number]["status"],
): FiledReturnsFullFiscalYearLedger["targets"][number] {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    targetId: `GSTR-3B:2026-27:${period}`,
    financialYear: "2026-27",
    period,
    returnType: "GSTR-3B",
    status,
    attempts: status === "pending" ? 0 : 1,
    safeSignals: [],
    safeMessage: `${period} ${status}`,
    updatedAt: now,
  };
}
