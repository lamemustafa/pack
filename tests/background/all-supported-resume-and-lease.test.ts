import { describe, expect, it } from "vitest";
import { toAllSupportedFullFiscalYearSummary } from "../../src/background/filed-returns-all-supported-full-fiscal-year-summary";
import type { FiledReturnsAllSupportedFullFiscalYearLedger } from "../../src/background/filed-returns-all-supported-full-fiscal-year-validation";

/**
 * Two properties the panel depends on and that age alone cannot establish.
 *
 * A root ledger records no heartbeat while an atomic child is running, and a child may legitimately
 * outlast the root's staleness window -- the content-message timeout alone is sixty seconds. Judging
 * by age tells the reader the worker stopped while it is mid-target. The run's lease renews every
 * ten seconds and is the evidence that separates a stopped worker from a busy one.
 *
 * Separately, the runner saves `export-retry-pending` and the cleanup-pending phases so that exact
 * phase is retried when the same start is invoked again. A surface that blocks every non-terminal
 * run hides the only route to those branches.
 */

const STALE_AT = "2026-08-30T05:00:00.000Z";
const LONG_AFTER = new Date("2026-08-30T05:05:00.000Z");

function runningLedger(
  zipPhase?: FiledReturnsAllSupportedFullFiscalYearLedger["zipPhase"],
): FiledReturnsAllSupportedFullFiscalYearLedger {
  return {
    schemaVersion: "1.0",
    ledgerId: "lease-probe",
    status: "running",
    planRoot: { kind: "all-supported-returns-full-fiscal-year", financialYear: "2025-26" },
    createdAt: STALE_AT,
    updatedAt: STALE_AT,
    ...(zipPhase ? { zipPhase } : {}),
    targets: [
      {
        targetId: "GSTR-3B:2025-26:April",
        financialYear: "2025-26",
        period: "April",
        returnType: "GSTR-3B",
        artifactType: "PDF",
        status: "running",
        attempts: 1,
        safeSignals: [],
        safeMessage: "",
        updatedAt: STALE_AT,
      },
    ],
  } as unknown as FiledReturnsAllSupportedFullFiscalYearLedger;
}

describe("an all-supported root whose child is still working", () => {
  it("is not called interrupted while its lease is live", () => {
    expect(toAllSupportedFullFiscalYearSummary(runningLedger(), LONG_AFTER, true).status).toBe(
      "running",
    );
  });

  it("is called interrupted once the lease is not", () => {
    expect(toAllSupportedFullFiscalYearSummary(runningLedger(), LONG_AFTER, false).status).toBe(
      "blocked",
    );
  });
});

describe("whether resuming would actually advance the plan", () => {
  // Mirrors the branches of `continueSavedAllSupportedFullFiscalYearRun` that do work. A branch
  // returning the same interrupted or review state unchanged must not enable the control, or the
  // reader presses something that cannot help; withholding it on a genuinely resumable plan leaves
  // discarding as the only way out. Two earlier attempts erred in each direction.
  it.each([
    ["export-pending"],
    ["export-retry-pending"],
    ["downloaded-cleanup-pending"],
    ["no-artifacts-cleanup-pending"],
  ])("advances at %s", (phase) => {
    const summary = toAllSupportedFullFiscalYearSummary(
      runningLedger(phase as never),
      LONG_AFTER,
      true,
    );
    expect(summary.resumeAvailable).toBe(true);
    expect(summary.resumeMode).toBe("local-only");
  });

  it("retains every terminal root in the summary projection", () => {
    const terminalRoots = [
      { financialYear: "2025-26", status: "complete" as const, periodCount: 12 },
      { financialYear: "2026-27", status: "cancelled" as const, periodCount: 4 },
    ];
    const summary = toAllSupportedFullFiscalYearSummary(
      runningLedger(),
      LONG_AFTER,
      true,
      terminalRoots,
    );
    expect(summary.terminalPlanRoots).toEqual(terminalRoots);
  });

  it("advances at download-observing once a browser download is recorded", () => {
    const withDownload = {
      ...runningLedger("download-observing" as never),
      zipDownloadAttempt: { requestedAt: STALE_AT, downloadId: 7 },
    } as never;
    expect(toAllSupportedFullFiscalYearSummary(withDownload, LONG_AFTER, true)).toMatchObject({
      resumeAvailable: true,
      resumeMode: "local-only",
    });
  });

  it("does not advance at download-observing without one", () => {
    // The runner returns the manual-review step unchanged in that case.
    expect(
      toAllSupportedFullFiscalYearSummary(
        runningLedger("download-observing" as never),
        LONG_AFTER,
        true,
      ).resumeAvailable,
    ).toBe(false);
  });

  it("does not advance while a target is still marked running", () => {
    // That ledger belongs to the interrupted projection, not to a resume.
    expect(
      toAllSupportedFullFiscalYearSummary(runningLedger(), LONG_AFTER, true).resumeAvailable,
    ).toBe(false);
  });

  it("advances when running with no target left running", () => {
    const idle = {
      ...runningLedger(),
      targets: [{ ...runningLedger().targets[0]!, status: "pending" }],
    } as never;
    expect(toAllSupportedFullFiscalYearSummary(idle, LONG_AFTER, true).resumeAvailable).toBe(true);
  });

  it.each([["complete"], ["cancelled"]])("does not advance a %s root", (status) => {
    const terminal = { ...runningLedger(), status } as never;
    expect(toAllSupportedFullFiscalYearSummary(terminal, LONG_AFTER, true).resumeAvailable).toBe(
      false,
    );
  });
});

describe("the message a leased run shows", () => {
  it("does not say Pack stopped while the lease is live", () => {
    // Status and flow-step message must agree: "running" beside "Pack stopped" is the
    // contradiction the reader actually sees.
    const summary = toAllSupportedFullFiscalYearSummary(runningLedger(), LONG_AFTER, true);
    expect(summary.status).toBe("running");
    expect(summary.flowStep.safeMessage).not.toMatch(/stopped|interrupted/i);
  });

  it("says so once the lease is not live", () => {
    const summary = toAllSupportedFullFiscalYearSummary(runningLedger(), LONG_AFTER, false);
    expect(summary.status).toBe("blocked");
    expect(summary.flowStep.safeMessage).toMatch(/stopped|interrupted/i);
  });
});
