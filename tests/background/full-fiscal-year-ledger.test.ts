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

describe("full fiscal year ledger", () => {
  it("does not select later targets while an unconfirmed download needs acknowledgement", () => {
    const ledger = createLedger([
      ["April", "download-unconfirmed"],
      ["May", "pending"],
    ]);

    expect(nextRunnableFullFiscalYearTarget(ledger)).toBeNull();
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
