import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  FiledReturnsTargetReview,
  PortalFlowStepResult,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";

export interface FiledReturnsTargetReviewDeps {
  storageKeys: {
    targetReview?: string;
  };
  now?: () => Date;
}

export async function readFiledReturnsTargetReview(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsTargetReviewDeps,
): Promise<FiledReturnsTargetReview | null> {
  const key = deps.storageKeys.targetReview;
  if (!key) return null;

  const values = await browser.storage.local.get(key);
  const review = parseFiledReturnsTargetReview(values[key]);
  if (!review || !sameFiledReturnsScope(review.scope, scope)) return null;
  return review;
}

export async function readCurrentFiledReturnsTargetReviewSummary(
  deps: FiledReturnsTargetReviewDeps,
): Promise<FiledReturnsFlowSummary | null> {
  const key = deps.storageKeys.targetReview;
  if (!key) return null;

  const values = await browser.storage.local.get(key);
  const review = parseFiledReturnsTargetReview(values[key]);
  return review ? toTargetReviewSummary(review) : null;
}

export function responseForFiledReturnsTargetReview(
  review: FiledReturnsTargetReview,
): PackMessageResponse {
  const flowStep = targetReviewStep(review);
  return {
    ok: true,
    flowStep,
    flowSummary: toTargetReviewSummary(review, flowStep),
  };
}

export async function persistFiledReturnsTargetReview(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
  deps: FiledReturnsTargetReviewDeps,
): Promise<void> {
  const key = deps.storageKeys.targetReview;
  if (!key || !requiresTargetReview(flowStep)) return;

  const timestamp = (deps.now?.() ?? new Date()).toISOString();
  await browser.storage.local.set({
    [key]: {
      schemaVersion: "1.0",
      targetId: createTargetId(scope),
      status: "download-unconfirmed",
      scope,
      safeSignals: flowStep.safeSignals,
      safeMessage: flowStep.safeMessage,
      updatedAt: timestamp,
    } satisfies FiledReturnsTargetReview,
  });
}

export async function clearFiledReturnsTargetReview(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsTargetReviewDeps,
): Promise<void> {
  const key = deps.storageKeys.targetReview;
  if (!key) return;

  const review = await readFiledReturnsTargetReview(scope, deps);
  if (review) await browser.storage.local.remove(key);
}

export async function resolveUnconfirmedFiledReturnsDownload(
  scope: FiledReturnsDownloadScope,
  resolution: "downloaded" | "cancelled",
  deps: FiledReturnsTargetReviewDeps,
): Promise<PackMessageResponse> {
  const review = await readFiledReturnsTargetReview(scope, deps);
  if (!review) return noTargetReviewResponse(scope);

  await clearFiledReturnsTargetReview(scope, deps);
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: resolution === "downloaded" ? "downloaded" : "user-action-required",
    safeSignals: [
      resolution === "downloaded"
        ? "filed-returns-target-manually-confirmed"
        : "filed-returns-target-cancelled",
    ],
    safeMessage:
      resolution === "downloaded"
        ? "Pack marked the unresolved filed-return download as manually reviewed."
        : "Pack cancelled the unresolved filed-return target. No portal click was retried.",
  };
  return {
    ok: true,
    flowStep,
    flowSummary: {
      scope,
      status: resolution === "downloaded" ? "complete" : "cancelled",
      completedPeriods: resolution === "downloaded" ? [scope.period] : [],
      totalPeriods: 1,
      updatedAt: (deps.now?.() ?? new Date()).toISOString(),
      flowStep,
    },
  };
}

function parseFiledReturnsTargetReview(input: unknown): FiledReturnsTargetReview | null {
  if (!input || typeof input !== "object") return null;
  const review = input as Partial<FiledReturnsTargetReview>;
  if (review.schemaVersion !== "1.0") return null;
  if (!isBoundedString(review.targetId, 1, 120)) return null;
  if (review.status !== "download-unconfirmed") return null;
  if (!review.scope || typeof review.scope !== "object") return null;
  if (review.targetId !== createTargetId(review.scope as FiledReturnsDownloadScope)) return null;
  if (
    typeof review.scope.financialYear !== "string" ||
    typeof review.scope.period !== "string" ||
    review.scope.returnType !== "GSTR-3B"
  ) {
    return null;
  }
  if (
    !Array.isArray(review.safeSignals) ||
    !review.safeSignals.every((signal) => isBoundedString(signal, 1, 160))
  ) {
    return null;
  }
  if (!isBoundedString(review.safeMessage, 1, 500)) return null;
  if (typeof review.updatedAt !== "string" || !Number.isFinite(Date.parse(review.updatedAt))) {
    return null;
  }
  return review as FiledReturnsTargetReview;
}

function toTargetReviewSummary(
  review: FiledReturnsTargetReview,
  flowStep = targetReviewStep(review),
): FiledReturnsFlowSummary {
  return {
    scope: review.scope,
    status: "blocked",
    completedPeriods: [],
    totalPeriods: 1,
    currentPeriod: review.scope.period,
    updatedAt: review.updatedAt,
    flowStep,
  };
}

function targetReviewStep(review: FiledReturnsTargetReview): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "user-action-required",
    safeSignals: ["filed-returns-target-review-required"],
    safeMessage: review.safeMessage,
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Choose an explicit retry or cancellation before Pack clicks this period again.",
      canResume: true,
    },
  };
}

function noTargetReviewResponse(scope: FiledReturnsDownloadScope): PackMessageResponse {
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "user-action-required",
    safeSignals: ["filed-returns-target-review-not-found"],
    safeMessage: "Pack did not find an unresolved filed-return target for this period.",
  };
  return {
    ok: true,
    flowStep,
    flowSummary: {
      scope,
      status: "blocked",
      completedPeriods: [],
      totalPeriods: 1,
      currentPeriod: scope.period,
      flowStep,
    },
  };
}

function requiresTargetReview(step: PortalFlowStepResult): boolean {
  return (
    step.state === "download-unconfirmed" ||
    step.safeSignals.some((signal) =>
      [
        "browser-download-size-unknown",
        "browser-download-not-observed",
        "filed-gstr3b-download-trigger-ambiguous",
      ].includes(signal),
    )
  );
}

function sameFiledReturnsScope(
  left: FiledReturnsDownloadScope,
  right: FiledReturnsDownloadScope,
): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType
  );
}

function createTargetId(scope: FiledReturnsDownloadScope): string {
  return `GSTR-3B:${scope.financialYear}:${scope.period}`;
}

function isBoundedString(input: unknown, minLength: number, maxLength: number): input is string {
  return typeof input === "string" && input.length >= minLength && input.length <= maxLength;
}
