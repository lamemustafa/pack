import { describe, expect, it } from "vitest";
import {
  durableFiledReturnsSignalRejectionReason,
  isDurableFiledReturnsSignal,
  parseDurableFiledReturnsSignals,
} from "../../src/connectors/gst/filed-returns-durable-signals";
import {
  GSTR2B_ARTIFACT_DISPATCH_FAILURE_MESSAGES,
  Gstr2bArtifactDispatchFailureReason,
} from "../../src/background/filed-returns-download-trigger";
import {
  SINGLE_PERIOD_CLEANUP_CHECKPOINT_FAILURE_STAGES,
  singlePeriodCleanupCheckpointFailureSignal,
} from "../../src/connectors/gst/single-period-cleanup-checkpoint";
import { scoreFiledReturnDownloadCandidate } from "../../src/connectors/gst/filed-returns-download-candidates";
import { scoreFiledReturnsSummaryModalDismissalCandidate } from "../../src/connectors/gst/filed-returns-navigation-candidates";
import { detectSafeSignals } from "../../src/connectors/gst/filed-returns-observer-signals";

describe("filed-return durable signal contract", () => {
  it("keeps live GSTR-3B detail observations persistable for terminal recovery", () => {
    // The full-year ledger persists the terminal step if the portal stops before
    // acquisition. These are fixed classifier tokens (not portal text), so the
    // durable boundary may retain them without widening its privacy surface.
    const signals = detectSafeSignals("gstr-3b monthly return download filed gstr-3b pdf", {
      pathname: "/returns/auth/gstr3b",
    });

    expect(signals).toEqual(
      expect.arrayContaining([
        "gstr-3b-detail-route",
        "gstr-3b",
        "download-filed-gstr-3b",
        "filed",
        "download",
        "pdf",
      ]),
    );
    expect(parseDurableFiledReturnsSignals(signals)).toEqual(signals);
  });

  it("keeps every live classifier signal inside the durable allow-list", () => {
    // parseDurableFiledReturnsSignals fails closed: one unrecognised signal
    // rejects the whole persisted summary. These two classifiers are live —
    // filed-returns-download-candidates.ts and filed-returns-summary-overlay.ts
    // call them in production — so any signal they gain must be added to the
    // allow-list in the same change or recovery records silently vanish.
    //
    // This assertion previously lived in a case that also exercised the orphaned
    // detail-page guard. That guard is deleted; the contract for these live
    // classifiers is not, and is kept here on its own.
    const emitted = new Set<string>();
    const collect = (signals: readonly string[]) => {
      for (const signal of signals) emitted.add(signal);
    };

    for (const scored of [
      scoreFiledReturnDownloadCandidate(
        { text: "DOWNLOAD FILED GSTR-3B SYSTEM GENERATED SAVE" },
        "GSTR-3B",
      ),
      scoreFiledReturnDownloadCandidate({ text: "DOWNLOAD FILED GSTR-1 PDF SAVE EXCEL" }, "GSTR-1"),
      scoreFiledReturnDownloadCandidate({ text: "DOWNLOAD PDF" }, "GSTR-1"),
      scoreFiledReturnDownloadCandidate(
        { text: "DOWNLOAD DETAILS E-INVOICES EXCEL PDF SAVE" },
        "GSTR-1",
        "EXCEL",
      ),
      scoreFiledReturnDownloadCandidate(
        { text: "DOWNLOAD GSTR-2B SUMMARY PDF SAVE EXCEL" },
        "GSTR-2B",
      ),
      scoreFiledReturnDownloadCandidate(
        { text: "DOWNLOAD GSTR-2B DETAILS E-INVOICES EXCEL PDF SAVE" },
        "GSTR-2B",
        "EXCEL",
      ),
      scoreFiledReturnDownloadCandidate({ text: "GSTR-1" }, "GSTR-1"),
    ]) {
      collect(scored.safeSignals);
    }

    collect(
      scoreFiledReturnsSummaryModalDismissalCandidate({
        ariaLabel: "Close",
        className: "close",
        text: "",
      }).safeSignals,
    );
    collect(scoreFiledReturnsSummaryModalDismissalCandidate({ text: "x" }).safeSignals);
    collect(scoreFiledReturnsSummaryModalDismissalCandidate({ text: "Download" }).safeSignals);

    const signals = [...emitted];
    expect(signals.length).toBeGreaterThanOrEqual(20);
    expect(signals.filter((signal) => !isDurableFiledReturnsSignal(signal))).toEqual([]);
    const representative = signals.slice(0, 32);
    expect(parseDurableFiledReturnsSignals(representative)).toEqual(representative);
  });

  it("accepts only bounded OPFS clear error categories", () => {
    for (const prefix of ["filed-returns", "full-fiscal-year", "single-period"]) {
      expect(isDurableFiledReturnsSignal(`${prefix}-opfs-clear-error:clear-failed`)).toBe(true);
      expect(isDurableFiledReturnsSignal(`${prefix}-opfs-clear-error:opfs-unavailable`)).toBe(true);
      expect(isDurableFiledReturnsSignal(`${prefix}-opfs-clear-error:private-value`)).toBe(false);
      expect(isDurableFiledReturnsSignal(`${prefix}-opfs-clear-offscreen-unreachable`)).toBe(true);
      expect(isDurableFiledReturnsSignal(`${prefix}-opfs-clear-offscreen-response-invalid`)).toBe(
        true,
      );
    }
  });

  it("retains the filename-free ZIP override marker", () => {
    expect(isDurableFiledReturnsSignal("zip-download-filename-overridden")).toBe(true);
    expect(parseDurableFiledReturnsSignals(["zip-download-filename-overridden"])).toEqual([
      "zip-download-filename-overridden",
    ]);
  });

  it("persists bounded Returns Dashboard preflight failures", () => {
    const signals = ["wrong-origin-open-returns-dashboard", "returns-dashboard-anchor-ambiguous"];

    expect(parseDurableFiledReturnsSignals(signals)).toEqual(signals);
    expect(isDurableFiledReturnsSignal("returns-dashboard-anchor-private-value")).toBe(false);
  });

  it("retains the cleanup-without-download recovery marker", () => {
    expect(isDurableFiledReturnsSignal("single-period-zip-cleanup-without-download")).toBe(true);
    expect(parseDurableFiledReturnsSignals(["single-period-zip-cleanup-without-download"])).toEqual(
      ["single-period-zip-cleanup-without-download"],
    );
  });

  it("retains artifact acquisition recovery signals", () => {
    const signals = [
      "artifact-acquisition-checkpoint-malformed",
      "artifact-acquisition-checkpoint-clear-failed",
      "artifact-acquisition-download-interrupted",
      "artifact-acquisition-download-reconciled",
      "artifact-acquisition-session-proof-expired",
    ];
    expect(parseDurableFiledReturnsSignals(signals)).toEqual(signals);
    expect(signals.every(isDurableFiledReturnsSignal)).toBe(true);
  });

  it("retains categorical artifact page-identity diagnostics", () => {
    const signals = [
      "target-period-verified",
      "page-target-unverified",
      "page-identity-region-not-found",
    ];

    expect(parseDurableFiledReturnsSignals(signals)).toEqual(signals);
  });

  it("retains only canonical GSTR detail identity projections", () => {
    const signals = [
      "filed-return-detail-period:April",
      "filed-return-detail-financial-year:2025-26",
      "filed-return-detail-type:GSTR-3B",
    ];

    expect(parseDurableFiledReturnsSignals(signals)).toEqual(signals);
    expect(isDurableFiledReturnsSignal("filed-return-detail-financial-year:2025-27")).toBe(false);
    expect(isDurableFiledReturnsSignal("filed-return-detail-financial-year:private-value")).toBe(
      false,
    );
    expect(isDurableFiledReturnsSignal("filed-return-detail-type:private-value")).toBe(false);
  });

  it("retains only bounded full-year summary status and counts", () => {
    const signals = [
      "full-fiscal-year-summary-included",
      "full-fiscal-year-summary-outcomes-only",
      "full-fiscal-year-summary-parsed-period-count:0",
      "full-fiscal-year-summary-row-count:100000",
      "full-fiscal-year-summary-error:too-large",
    ];

    expect(parseDurableFiledReturnsSignals(signals)).toEqual(signals);
    expect(isDurableFiledReturnsSignal("full-fiscal-year-summary-parsed-period-count:13")).toBe(
      false,
    );
    expect(isDurableFiledReturnsSignal("full-fiscal-year-summary-row-count:0")).toBe(false);
    expect(isDurableFiledReturnsSignal("full-fiscal-year-summary-row-count:100001")).toBe(false);
    expect(isDurableFiledReturnsSignal("full-fiscal-year-summary-error:portal-value")).toBe(false);
    expect(isDurableFiledReturnsSignal("full-fiscal-year-zip-entry-count:37")).toBe(true);
    expect(isDurableFiledReturnsSignal("full-fiscal-year-zip-entry-count:38")).toBe(true);
    expect(isDurableFiledReturnsSignal("full-fiscal-year-zip-entry-count:39")).toBe(false);
  });

  it("retains categorical page-generated artifact readiness evidence", () => {
    const signals = ["page-generated-pdf-ready", "page-generated-excel-ready"];

    expect(parseDurableFiledReturnsSignals(signals)).toEqual(signals);
    expect(isDurableFiledReturnsSignal("page-generated-private-value-ready")).toBe(false);
  });

  it("retains final GSTR-2B capture-control rejections", () => {
    const signals = [
      "gstr2b-capture-control-not-actionable",
      "gstr2b-capture-control-artifact-mismatch",
    ];

    expect(parseDurableFiledReturnsSignals(signals)).toEqual(signals);
    expect(isDurableFiledReturnsSignal("capture-control-not-actionable")).toBe(false);
    expect(isDurableFiledReturnsSignal("capture-control-artifact-mismatch")).toBe(false);
  });

  it("retains the categorical GSTR-1 visible-scope mismatch marker", () => {
    expect(parseDurableFiledReturnsSignals(["filed-gstr1-visible-scope-mismatch"])).toEqual([
      "filed-gstr1-visible-scope-mismatch",
    ]);
  });

  it("accepts only the closed cleanup-checkpoint failure stages", () => {
    for (const stage of SINGLE_PERIOD_CLEANUP_CHECKPOINT_FAILURE_STAGES) {
      expect(isDurableFiledReturnsSignal(singlePeriodCleanupCheckpointFailureSignal(stage))).toBe(
        true,
      );
    }
    expect(
      isDurableFiledReturnsSignal("single-period-cleanup-checkpoint-failed:private-value"),
    ).toBe(false);
  });

  it("continues to reject unknown, interpolated, duplicate, and over-cap signal vectors", () => {
    for (const suffix of [
      "capture-control-artifact-mismatch",
      "capture-target-binding-invalid",
      "capture-target-evidence-conflict",
    ]) {
      expect(isDurableFiledReturnsSignal(`filed-gstr3b-${suffix}`)).toBe(true);
    }
    expect(isDurableFiledReturnsSignal("gstr3b-detail-route:private-value")).toBe(false);
    expect(isDurableFiledReturnsSignal("text-download-filed-gstr9")).toBe(false);
    expect(parseDurableFiledReturnsSignals(["status-filed", "status-filed"])).toBeNull();
    expect(durableFiledReturnsSignalRejectionReason(["status-filed", "status-filed"])).toBe(
      "duplicate",
    );
    expect(durableFiledReturnsSignalRejectionReason(["synthetic-portal-option-value"])).toBe(
      "unknown",
    );
    expect(durableFiledReturnsSignalRejectionReason(["filed-return-detail-synthetic-value"])).toBe(
      "unknown-detail-identity",
    );
    expect(durableFiledReturnsSignalRejectionReason(["artifact-synthetic-value"])).toBe(
      "unknown-artifact",
    );
    expect(durableFiledReturnsSignalRejectionReason(["filed-return-synthetic-value"])).toBe(
      "unknown-flow",
    );
    expect(durableFiledReturnsSignalRejectionReason(["gstr3b-synthetic-value"])).toBe(
      "unknown-navigation",
    );
    expect(durableFiledReturnsSignalRejectionReason("not-a-signal-array")).toBe("not-array");
    expect(durableFiledReturnsSignalRejectionReason(["status-filed", 1])).toBe("non-string");
    expect(parseDurableFiledReturnsSignals([""])).toBeNull();
    expect(durableFiledReturnsSignalRejectionReason([""])).toBe("unknown");
    const sparseSignals: unknown[] = Array(1);
    expect(parseDurableFiledReturnsSignals(sparseSignals)).toBeNull();
    expect(durableFiledReturnsSignalRejectionReason(sparseSignals)).toBe("non-string");
    expect(
      parseDurableFiledReturnsSignals(
        Array.from({ length: 33 }, (_, index) => `browser-download-id:${index + 1}`),
      ),
    ).toBeNull();
    expect(
      durableFiledReturnsSignalRejectionReason(
        Array.from({ length: 33 }, (_, index) => `browser-download-id:${index + 1}`),
      ),
    ).toBe("over-cap");
  });

  it("accepts bounded GSTR-1 dashboard recovery signals without persisting selected values", () => {
    const signals = [
      "gstr1-filed-returns-route-mismatched",
      "return-dashboard-initial-scan",
      "return-dashboard-after-services-menu",
      "return-dashboard-after-returns-menu",
      "no-return-dashboard-candidate",
      "gstr1-return-dashboard-route",
      "gstr1-dashboard-root-found",
      "gstr1-dashboard-year-select-found",
      "gstr1-dashboard-quarter-select-found",
      "gstr1-dashboard-period-select-found",
      "gstr1-dashboard-search-found",
      "gstr1-return-dashboard-filters-selected",
      "gstr1-return-dashboard-search-results-pending",
      "gstr1-dashboard-view-clicked",
    ];

    expect(parseDurableFiledReturnsSignals(signals)).toEqual(signals);
    expect(isDurableFiledReturnsSignal("gstr1-dashboard-selected-period:april")).toBe(false);
    expect(isDurableFiledReturnsSignal("gstr1-dashboard-selected-year:2026-27")).toBe(false);
  });

  it("accepts only fixed full-year system-error predecessor categories", () => {
    const signal = "full-fiscal-year-system-error-preceded-by:detail-navigation";

    expect(parseDurableFiledReturnsSignals(["portal-system-error", signal])).toEqual([
      "portal-system-error",
      signal,
    ]);
    expect(
      isDurableFiledReturnsSignal("full-fiscal-year-system-error-preceded-by:private-value"),
    ).toBe(false);
  });

  it("accepts only bounded GSTR-2B dashboard recovery and selected-filter signals", () => {
    const signals = [
      "gstr2b-return-dashboard-route",
      "gstr2b-dashboard-root-found",
      "gstr2b-dashboard-year-select-found",
      "gstr2b-dashboard-quarter-select-found",
      "gstr2b-dashboard-period-select-found",
      "gstr2b-dashboard-search-found",
      "gstr2b-dashboard-selected-year:2026-27",
      "gstr2b-dashboard-selected-quarter:quarter-1-apr-jun",
      "gstr2b-dashboard-selected-quarter:apr-jun",
      "gstr2b-dashboard-selected-period:april",
      "gstr2b-return-dashboard-filter-selection-in-progress",
      "period-selected",
      "gstr2b-dashboard-view-unchanged-after-search",
    ];

    expect(parseDurableFiledReturnsSignals(signals)).toEqual(signals);
    expect(parseDurableFiledReturnsSignals([...signals, signals[0]])).toBeNull();
    for (const signal of [
      "gstr2b-dashboard-selected-year:2026-28",
      "gstr2b-dashboard-selected-year:private-value",
      "gstr2b-dashboard-selected-quarter:quarter-5-apr-jun",
      "gstr2b-dashboard-selected-quarter:private-value",
      "gstr2b-dashboard-selected-period:not-a-month",
      "gstr2b-dashboard-selected-period:april:private-value",
    ]) {
      expect(isDurableFiledReturnsSignal(signal)).toBe(false);
    }
  });

  it("accepts every GSTR-2B acquisition terminal reason for durable summaries", () => {
    const reasons = Object.values(Gstr2bArtifactDispatchFailureReason);

    expect(parseDurableFiledReturnsSignals(reasons)).toEqual(reasons);
    for (const reason of reasons) {
      expect(GSTR2B_ARTIFACT_DISPATCH_FAILURE_MESSAGES[reason].trim()).not.toBe("");
    }
  });

  it("accepts only the fixed categorical capture-context diagnostics", () => {
    const diagnosticSuffixes = [
      "xhr-selection-closed-with-context",
      "xhr-selection-closed-without-context",
      "xhr-page-callback-bound-readystatechange",
      "xhr-page-callback-bound-load",
      "xhr-page-callback-bound-loadend",
      "unbound-create-object-url-no-open-selection",
      "unbound-create-object-url-selection-open-no-context",
      "unbound-create-object-url-selection-open-invalid-context",
      "unbound-create-object-url-selection-open-valid-inactive-context",
    ];
    const signals = diagnosticSuffixes.map((suffix) => `filed-gstr3b-${suffix}`);

    expect(parseDurableFiledReturnsSignals(signals)).toEqual(signals);

    for (const signal of [
      `${signals[0]}:1`,
      `${signals[2]}:event=loadend`,
      `${signals[6]}:private-value`,
      `${signals[8]}-extra`,
      `filed-gstr9-${diagnosticSuffixes[0]}`,
    ]) {
      expect(isDurableFiledReturnsSignal(signal)).toBe(false);
      expect(parseDurableFiledReturnsSignals([signals[0], signal])).toBeNull();
    }
  });
});
