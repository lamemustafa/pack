import { describe, expect, it } from "vitest";
import { parseDurableFiledReturnsSignals } from "../../src/connectors/gst/filed-returns-durable-signals";
import {
  FILED_RETURNS_TARGET_REVIEW_CLEAR_FAILURE_STAGES,
  isFiledReturnsTargetReviewClearFailureSignal,
} from "../../src/connectors/gst/filed-returns-target-review-clear";

describe("target-review clear signal family", () => {
  it("keeps the historical bare signal recognized and durable", () => {
    const signal = "filed-returns-target-review-clear-failed";
    expect(isFiledReturnsTargetReviewClearFailureSignal(signal)).toBe(true);
    expect(parseDurableFiledReturnsSignals([signal])).toEqual([signal]);
  });

  it.each(FILED_RETURNS_TARGET_REVIEW_CLEAR_FAILURE_STAGES)(
    "recognizes and durably registers the exact %s stage",
    (stage) => {
      // Deliberately independent of the emitter: a builder that collapses all
      // stages must not also generate this test's expected values.
      const signal = `filed-returns-target-review-clear-failed:${stage}`;
      expect(isFiledReturnsTargetReviewClearFailureSignal(signal)).toBe(true);
      expect(parseDurableFiledReturnsSignals([signal])).toEqual([signal]);
    },
  );

  it.each([
    "filed-returns-target-review-clear-failed:",
    "filed-returns-target-review-clear-failed:unknown-stage",
    "filed-returns-target-review-clear-failed:STORAGE-KEY-MISSING",
    "filed-returns-target-review-clear-failed:storage-key-missing:extra",
    "filed-returns-target-review-clear-failed:storage-key-missing ",
    "filed-returns-target-review-clear-failed-lookalike:storage-key-missing",
    "lookalike-filed-returns-target-review-clear-failed:storage-key-missing",
  ])("rejects the unregistered lookalike %s", (signal) => {
    expect(isFiledReturnsTargetReviewClearFailureSignal(signal)).toBe(false);
    expect(parseDurableFiledReturnsSignals(["browser-download-completed", signal])).toBeNull();
  });
});
