import { describe, expect, it } from "vitest";
import type {
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTargetStatus,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import { toFullFiscalYearSummary } from "../../src/background/filed-returns-full-fiscal-year-summary";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import { parseDurableFiledReturnsFlowSummary } from "../../src/background/filed-returns-durable-summary";

const ZIP_DELIVERED: PortalFlowStepResult = {
  connectorId: "gst",
  scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
  state: "downloaded",
  safeMessage: "",
  safeSignals: ["full-fiscal-year-zip-downloaded"],
};

const FLOW_STEP: PortalFlowStepResult = {
  connectorId: "gst",
  scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
  state: "downloaded",
  safeMessage: "",
  safeSignals: [],
};

function ledgerWith(
  statuses: readonly FiledReturnsFullFiscalYearTargetStatus[],
): FiledReturnsFullFiscalYearLedger {
  const periods = ["April", "May", "June", "July"] as const;
  return {
    ledgerId: "full-fiscal-year-12345678",
    revision: 1,
    scope: {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    },
    status: "partial",
    createdAt: "2026-08-23T12:00:00.000Z",
    updatedAt: "2026-08-23T12:00:00.000Z",
    targets: statuses.map((status, index) => ({
      targetId: `t${index}`,
      period: periods[index]!,
      status,
    })),
  } as FiledReturnsFullFiscalYearLedger;
}

describe("per-target evidence in the flow summary", () => {
  // Only `downloaded` asserts correlated download evidence. `not-filed` is a
  // true outcome and not a saved file, and a manual observation is a person's
  // report -- the ledger already refuses to count it toward completion, and the
  // evidence list must not undo that by calling it saved.
  it("maps only a downloaded target to saved, once the ZIP is delivered", () => {
    const summary = toFullFiscalYearSummary(
      ledgerWith(["downloaded", "not-filed", "manually-observed", "download-unconfirmed"]),
      ZIP_DELIVERED,
    );

    expect(summary.targetEvidence).toEqual([
      { period: "April", outcome: "saved" },
      { period: "May", outcome: "not-filed" },
      { period: "June", outcome: "needs-review" },
      { period: "July", outcome: "needs-review" },
    ]);
  });

  // `completedPeriods` groups downloaded with not-filed, which is right for
  // progress and wrong for evidence. Both are produced from one ledger, so this
  // pins that they disagree deliberately rather than by accident.
  it("keeps the evidence list narrower than completedPeriods", () => {
    const summary = toFullFiscalYearSummary(ledgerWith(["downloaded", "not-filed"]), ZIP_DELIVERED);

    expect(summary.completedPeriods).toEqual(["April", "May"]);
    expect(summary.targetEvidence?.filter((entry) => entry.outcome === "saved")).toEqual([
      { period: "April", outcome: "saved" },
    ]);
  });

  it("reports work still in flight rather than settling it", () => {
    const summary = toFullFiscalYearSummary(ledgerWith(["running", "pending"]), FLOW_STEP);

    expect(summary.targetEvidence).toEqual([
      { period: "April", outcome: "running" },
      { period: "May", outcome: "pending" },
    ]);
  });

  // Per-period outcomes include `not-filed`, which is a taxpayer's filing status
  // for a month. `AGENTS.md` permits scope selections to persist and taxpayer
  // data not to, and the ledger already holds these statuses where recovery
  // needs them. The evidence list is display-only: the durable parser accepts a
  // summary carrying it and drops it, so no second copy reaches storage.
  it("never carries per-period outcomes into durable state", () => {
    const summary = toFullFiscalYearSummary(ledgerWith(["downloaded", "not-filed"]), FLOW_STEP);
    expect(summary.targetEvidence).toBeDefined();

    const durable = parseDurableFiledReturnsFlowSummary(summary);

    expect(durable).not.toBeNull();
    expect(durable).not.toHaveProperty("targetEvidence");
    expect(JSON.stringify(durable)).not.toContain("not-filed");
  });

  // In a full-year run a `downloaded` target is staged in OPFS; the browser
  // handoff happens once, later, for the whole ZIP. Reading it as saved before
  // that asserts a delivery from a state that never reached the browser.
  it("reads a staged period as captured until the ZIP is delivered", () => {
    const staged = toFullFiscalYearSummary(ledgerWith(["downloaded", "downloaded"]), FLOW_STEP);
    expect(staged.targetEvidence?.map((entry) => entry.outcome)).toEqual(["captured", "captured"]);

    const delivered = toFullFiscalYearSummary(
      ledgerWith(["downloaded", "downloaded"]),
      ZIP_DELIVERED,
    );
    expect(delivered.targetEvidence?.map((entry) => entry.outcome)).toEqual(["saved", "saved"]);
  });

  // An interrupted run leaves the current target's durable status at `running`
  // while the ledger reports blocked. Nothing is running, so reading it as in
  // progress both misdescribes it and hides it from the needs-review count.
  it("treats a stale running target as needing review", () => {
    const ledger = ledgerWith(["running", "pending"]);
    const summary = toFullFiscalYearSummary({ ...ledger, status: "blocked" }, FLOW_STEP);

    expect(summary.targetEvidence).toEqual([
      { period: "April", outcome: "needs-review" },
      { period: "May", outcome: "pending" },
    ]);
  });
});
