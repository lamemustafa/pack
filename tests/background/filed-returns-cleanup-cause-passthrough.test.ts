import { describe, expect, it } from "vitest";
import type { FiledReturnsTargetReview } from "../../src/connectors/gst/filed-returns-contracts";
import { responseForFiledReturnsTargetReview } from "../../src/background/filed-returns-target-review";

const CAUSES = [
  "single-period-bundle-ledger-malformed",
  "single-period-bundle-scope-conflict",
  "single-period-bundle-revision-conflict",
  "single-period-bundle-state-read-failed",
  "single-period-opfs-clear-failed",
  // The cause behind a live failure that took four rounds to find: the download
  // and staging cleanup both succeed, Pack cannot delete its own review record,
  // and the renderer replaced this with the generic checkpoint signal -- so the
  // surface was used as evidence about the layer beneath it.
  "filed-returns-target-review-clear-failed",
] as const;

function reviewWith(cause: string): FiledReturnsTargetReview {
  return {
    schemaVersion: "1.0",
    revision: 1,
    scope: {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    },
    status: "download-unconfirmed",
    targetId: "GSTR-2B:2025-26:May:PDF_AND_EXCEL",
    safeSignals: [
      "single-period-opfs-cleared",
      // The emitter writes the generic alongside the cause; the fixture has to
      // carry both or it never reaches the branch under test.
      "single-period-cleanup-checkpoint-failed",
      cause,
      "single-period-zip-downloaded",
      "browser-download-completed",
      "browser-download-non-empty",
    ],
    safeMessage: "Synthetic cleanup failure.",
    updatedAt: "2026-08-24T00:00:00.000Z",
  } as never;
}

describe("single-period cleanup cause reaches the surface", () => {
  // Seven signals can select the cleanup-failure review state. Only two had a
  // pass-through, so five distinct causes surfaced as one hardcoded
  // `single-period-cleanup-checkpoint-failed` and could not be told apart from
  // outside -- which is exactly how a live failure resisted diagnosis.
  it.each(CAUSES)("keeps %s instead of a generic stand-in", (cause) => {
    const response = responseForFiledReturnsTargetReview(reviewWith(cause));

    if (!("flowStep" in response)) throw new Error("expected a filed-returns flow response");
    expect(response.flowStep.safeSignals).toContain(cause);
  });

  it("still blocks and still asks for review", () => {
    const response = responseForFiledReturnsTargetReview(reviewWith(CAUSES[0]));

    if (!("flowStep" in response)) throw new Error("expected a filed-returns flow response");
    expect(response.flowStep.state).toBe("blocked");
    expect(response.flowStep.safeSignals).toContain("filed-returns-target-review-required");
    expect(response.flowStep.safeSignals).toContain("filed-returns-target-local-cleanup-required");
  });

  it("names unavailable local recovery state without calling it malformed", () => {
    const review = reviewWith("single-period-bundle-state-read-failed");
    review.safeSignals = [
      ...review.safeSignals.filter((signal) => signal !== "single-period-opfs-cleared"),
      "single-period-opfs-retained",
    ];
    const response = responseForFiledReturnsTargetReview(review);

    if (!("flowStep" in response)) throw new Error("expected a filed-returns flow response");
    expect(response.flowStep.safeMessage).toContain(
      "could not read temporary selected-file recovery state",
    );
    expect(response.flowStep.safeMessage).not.toContain("missing or mismatched");
    expect(response.flowStep.userAction?.message).toContain("will not clear or replace it");
  });
});
