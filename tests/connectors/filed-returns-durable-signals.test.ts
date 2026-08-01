import { describe, expect, it } from "vitest";
import {
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

describe("filed-return durable signal contract", () => {
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
    expect(
      parseDurableFiledReturnsSignals(
        Array.from({ length: 33 }, (_, index) => `browser-download-id:${index + 1}`),
      ),
    ).toBeNull();
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
