import { describe, expect, it } from "vitest";
import { FILED_RETURNS_MONTHS } from "../../src/connectors/gst/filed-returns-scope";
import { createFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { markFullFiscalYearRestagingRequired } from "../../src/background/filed-returns-full-fiscal-year-staging";
import { isFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-validation";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import { RECOVERY_SCOPE } from "./full-year-completion-fixtures.test-helpers";

// A period the portal declined to draft is an answer, not an outcome still owed. Five separate
// places asked "is there a file to expect here?" by spelling it `status === "not-filed"`, so each
// one silently answered "no, keep working" for every declined period.
function ledgerWith(statuses: Partial<Record<string, { status: string; safeSignals?: string[] }>>) {
  const base = createFullFiscalYearLedger(
    RECOVERY_SCOPE,
    new Date("2026-08-24T00:00:00.000Z"),
    FILED_RETURNS_MONTHS,
  );
  return {
    ...base,
    targets: base.targets.map((target) => {
      const override = statuses[target.period];
      if (!override) return target;
      const status = override.status as (typeof target)["status"];
      const safeSignals = override.safeSignals ?? [];
      return {
        ...target,
        status,
        attempts: 1,
        ...canonicalDurableTargetStatus(target, status, safeSignals),
      };
    }),
  };
}

describe("restaging a fiscal year", () => {
  it("leaves a declined period alone, as it already does a not-filed one", () => {
    // Neither staged a file, so neither has anything to restage. Resetting a declined period to
    // `blocked` sends the run back to a period the portal has already answered.
    const ledger = ledgerWith({
      April: { status: "not-filed", safeSignals: ["filed-return-positively-not-filed"] },
      May: { status: "not-generated", safeSignals: ["filed-gstr2b-not-generated"] },
    });

    const restaged = markFullFiscalYearRestagingRequired(ledger, new Date("2026-08-26T00:00:00Z"));
    const byPeriod = new Map(restaged.targets.map((target) => [target.period, target.status]));

    expect(byPeriod.get("April")).toBe("not-filed");
    expect(byPeriod.get("May")).toBe("not-generated");
  });
});

describe("reading a stored fiscal-year ledger back", () => {
  it("refuses a declined period that carries no evidence it was declined", () => {
    // A status is a claim. The same rule already rejected a `not-filed` record with no portal
    // signal behind it; a `not-generated` record could assert the portal declined a period that
    // nothing ever established.
    const ledger = ledgerWith({ April: { status: "not-generated", safeSignals: [] } });

    expect(isFullFiscalYearLedger(ledger)).toBe(false);
  });

  it("refuses a declined period with a return-type-incompatible signal", () => {
    const ledger = ledgerWith({
      April: { status: "not-generated", safeSignals: ["filed-gstr2b-not-generated"] },
    });

    expect(isFullFiscalYearLedger(ledger)).toBe(false);
  });
});
