import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  persistFiledReturnsTargetReview,
  readCurrentFiledReturnsTargetReview,
  responseForFiledReturnsTargetReview,
} from "../../src/background/filed-returns-target-review";
import {
  persistCanonicalFiledReturnsFlowSummary,
  readCanonicalFiledReturnsFlowSummary,
} from "../../src/background/filed-returns-session-summary";
import type {
  FiledReturnsDownloadScope,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import { parseDurableFiledReturnsSignals } from "../../src/connectors/gst/filed-returns-durable-signals";
import {
  FILED_RETURNS_TARGET_REVIEW_CLEAR_FAILURE_STAGES,
  filedReturnsTargetReviewClearFailureSignal,
} from "../../src/connectors/gst/filed-returns-target-review-clear";
import {
  SINGLE_PERIOD_CLEANUP_CHECKPOINT_FAILURE_STAGES,
  singlePeriodCleanupCheckpointFailureSignal,
} from "../../src/connectors/gst/single-period-cleanup-checkpoint";
import { LastRunDiagnostics } from "../../src/entrypoints/popup/last-run-diagnostics";

const storage = vi.hoisted(() => {
  function area() {
    const values: Record<string, unknown> = {};
    return {
      values,
      get: vi.fn(async (key: string) =>
        Object.hasOwn(values, key) ? { [key]: structuredClone(values[key]) } : {},
      ),
      set: vi.fn(async (next: Record<string, unknown>) => {
        Object.assign(values, structuredClone(next));
      }),
      remove: vi.fn(async (key: string) => {
        delete values[key];
      }),
    };
  }
  return { local: area(), session: area() };
});

vi.mock("wxt/browser", () => ({ browser: { storage } }));

const scope = {
  artifactType: "PDF_AND_EXCEL",
  financialYear: "2025-26",
  period: "May",
  returnType: "GSTR-2B",
} satisfies FiledReturnsDownloadScope;
const deps = {
  storageKeys: { targetReview: "target-review" },
  now: () => new Date("2026-08-24T00:00:00.000Z"),
};

async function expectStoredStageReachesBlockedSurface(emitted: string, expected: string) {
  const step: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
    state: "blocked",
    safeMessage: "Synthetic checkpoint failure after staging cleanup.",
    safeSignals: [
      ...new Set([
        "single-period-opfs-cleared",
        "single-period-cleanup-checkpoint-failed",
        expected.split(":")[0]!,
        emitted,
        "single-period-zip-downloaded",
        "browser-download-completed",
        "browser-download-non-empty",
        "browser-download-id:7",
      ]),
    ],
  };

  expect(parseDurableFiledReturnsSignals(step.safeSignals)).toEqual(step.safeSignals);
  expect(await persistFiledReturnsTargetReview(scope, step, deps)).not.toBeNull();
  const review = await readCurrentFiledReturnsTargetReview(deps);
  if (!review) throw new Error("expected a canonical stored target review");
  expect(review.safeSignals, "stored review must retain the emitted stage").toContain(expected);
  expect(review.status).toBe("download-unconfirmed");

  const response = responseForFiledReturnsTargetReview(review);
  if (!("flowStep" in response) || !response.flowSummary) {
    throw new Error("expected a filed-returns review response and summary");
  }
  expect(response.flowStep.safeSignals, "review response must preserve the exact stage").toContain(
    expected,
  );
  expect(response.flowStep.safeSignals).toContain(expected.split(":")[0]);
  expect(response.flowStep.state).toBe("blocked");
  expect(response.flowSummary.status).toBe("blocked");
  expect(response.flowSummary.completedPeriods).toEqual([]);
  expect(response.flowStep.safeSignals).toEqual(
    expect.arrayContaining([
      "filed-returns-target-review-required",
      "filed-returns-target-local-cleanup-required",
      "single-period-cleanup-checkpoint-failed",
      "single-period-opfs-cleared",
    ]),
  );
  expect(response.flowStep.safeSignals).not.toContain("filed-return-durable-status-rejected");
  expect(parseDurableFiledReturnsSignals(response.flowStep.safeSignals)).toEqual(
    response.flowStep.safeSignals,
  );

  expect(
    await persistCanonicalFiledReturnsFlowSummary("completion", response.flowSummary),
  ).not.toBeNull();
  const summary = await readCanonicalFiledReturnsFlowSummary("completion");
  if (!summary) throw new Error("expected the durable blocked summary to round-trip");
  expect(summary.status).toBe("blocked");
  expect(summary.flowStep.state).toBe("blocked");
  expect(summary.completedPeriods).toEqual([]);
  expect(summary.flowStep.safeSignals).toContain(expected);

  const markup = renderToStaticMarkup(<LastRunDiagnostics summary={summary} />);
  expect(markup, "rendered diagnostics must preserve the exact stage").toContain(expected);
  expect(markup).toContain("filed-returns-target-review-required");
  expect(markup).toContain("filed-returns-target-local-cleanup-required");
  expect(markup).toContain("<dd>blocked</dd>");
  expect(storage.local.values[deps.storageKeys.targetReview]).toBeDefined();
  expect(storage.local.remove).not.toHaveBeenCalled();
}

describe("staged cleanup failures survive storage and rendered diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const area of [storage.local, storage.session]) {
      for (const key of Object.keys(area.values)) delete area.values[key];
    }
  });

  it.each(FILED_RETURNS_TARGET_REVIEW_CLEAR_FAILURE_STAGES)(
    "preserves review-clear stage %s through the blocked surface",
    async (stage) => {
      await expectStoredStageReachesBlockedSurface(
        filedReturnsTargetReviewClearFailureSignal(stage),
        `filed-returns-target-review-clear-failed:${stage}`,
      );
    },
  );

  it.each(SINGLE_PERIOD_CLEANUP_CHECKPOINT_FAILURE_STAGES)(
    "preserves emitted checkpoint stage %s through the blocked surface",
    async (stage) => {
      await expectStoredStageReachesBlockedSurface(
        singlePeriodCleanupCheckpointFailureSignal(stage),
        `single-period-cleanup-checkpoint-failed:${stage}`,
      );
    },
  );
});
