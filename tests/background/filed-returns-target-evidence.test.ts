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

  // The delivery signal is transient: it appears on the step that observes the
  // download, not on the completed step a later re-summarisation produces. So a
  // run whose ZIP downloaded and cleaned successfully reverted every period to
  // "captured" the moment the panel was reopened -- the inverse of the
  // overclaim, and just as wrong.
  // `zipPhase: "cleaned"` is NOT delivery evidence. A confirmed download, a run
  // that found no artifacts, and a legacy staging cleared on upgrade all reach
  // it, and the phase that distinguishes them is overwritten by the transition.
  // Inferring from it reported never-exported files as saved.
  it("does not infer delivery from a cleaned ledger", () => {
    const ledger = ledgerWith(["downloaded", "downloaded"]);
    const cleaned = { ...ledger, status: "complete" as const, zipPhase: "cleaned" as const };

    const summary = toFullFiscalYearSummary(cleaned, FLOW_STEP);

    expect(summary.targetEvidence?.map((entry) => entry.outcome)).toEqual(["captured", "captured"]);
  });

  // A run that found nothing eligible also cleans, having never produced a ZIP.
  // It has no downloaded target for a delivery claim to attach to, and must not
  // manufacture one.
  // A run where every period was positively not filed clears its staging too,
  // having produced nothing. Dropping the list there hid the proven `Not filed`
  // rows that are the whole result of the run, and they reappeared on reopen
  // once the transient clear signal was gone.
  it("keeps not-filed rows after a run that produced no artifacts", () => {
    const cleared = {
      ...FLOW_STEP,
      safeSignals: ["full-fiscal-year-opfs-cleared", "full-fiscal-year-no-zip-artifacts"],
    };

    const summary = toFullFiscalYearSummary(ledgerWith(["not-filed", "not-filed"]), cleared);

    expect(summary.targetEvidence?.map((entry) => entry.outcome)).toEqual([
      "not-filed",
      "not-filed",
    ]);
  });

  // An MV3 interruption produces a blocked summary while the persisted ledger
  // still reads `running`, so the ledger alone left the current target as
  // "In progress" and out of the needs-review count.
  it("treats a run the step reports as interrupted as needing review", () => {
    const interrupted = { ...FLOW_STEP, safeSignals: ["filed-returns-run-needs-review"] };

    const summary = toFullFiscalYearSummary(ledgerWith(["running", "pending"]), interrupted);

    expect(summary.targetEvidence?.map((entry) => entry.outcome)).toEqual([
      "needs-review",
      "pending",
    ]);
  });

  // Cancel and reset clears OPFS while the targets still read `downloaded`.
  // With no delivery signal those map to `captured`, which claims Pack holds
  // files it has just deleted -- the one thing a discarded run must not say.
  it("reports nothing for a run whose staged files were discarded", () => {
    const cleared = {
      ...FLOW_STEP,
      safeSignals: ["full-fiscal-year-opfs-cleared"],
    };

    const summary = toFullFiscalYearSummary(ledgerWith(["downloaded", "downloaded"]), cleared);

    expect(summary.targetEvidence).toEqual([]);
  });

  // A successful cleanup carries the same signal, and there the files did reach
  // the browser -- so the delivery check has to run first or a completed run
  // would report nothing at all.
  it("still reports a delivered run whose staged copy was cleaned", () => {
    const cleared = {
      ...FLOW_STEP,
      safeSignals: ["full-fiscal-year-opfs-cleared", "full-fiscal-year-zip-downloaded"],
    };

    const summary = toFullFiscalYearSummary(ledgerWith(["downloaded"]), cleared);

    expect(summary.targetEvidence).toEqual([{ period: "April", outcome: "saved" }]);
  });

  // A malformed active-run record is another state where Pack cannot say
  // whether work is running. Naming one signal left this one showing its target
  // as "In progress" and out of the review count -- the same defect the first
  // signal was added to fix, reached by the other door.
  it("treats a malformed active run as needing review", () => {
    const malformed = { ...FLOW_STEP, safeSignals: ["filed-returns-active-run-malformed"] };

    const summary = toFullFiscalYearSummary(ledgerWith(["running", "pending"]), malformed);

    expect(summary.targetEvidence?.map((entry) => entry.outcome)).toEqual([
      "needs-review",
      "pending",
    ]);
  });

  // Cancel and reset before any period reached `downloaded` deletes the ledger
  // just the same. Requiring staged files left the cancelled target reading
  // "Needs review" and the untouched ones "Waiting", for a run that no longer
  // exists.
  it("reports nothing for a discarded run that never staged anything", () => {
    const discarded = { ...FLOW_STEP, safeSignals: ["full-fiscal-year-run-discarded"] };

    const summary = toFullFiscalYearSummary(ledgerWith(["cancelled", "pending"]), discarded);

    expect(summary.targetEvidence).toEqual([]);
  });
});
