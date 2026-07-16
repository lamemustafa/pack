import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  FiledReturnsTargetReview,
  PortalFlowStepResult,
} from "../core/contracts";
import {
  concreteFiledReturnsArtifactTypes,
  normaliseFiledReturnsArtifactType,
} from "../core/filed-returns-artifacts";
import { isFiledReturnsReturnType } from "../core/filed-returns-return-types";
import type { PackMessageResponse } from "../core/messages";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import { readSinglePeriodStagingRecord } from "./filed-returns-artifact-progress";
import { discardSinglePeriodFiledReturnsZip } from "./filed-returns-full-fiscal-year-zip";

export interface FiledReturnsTargetReviewDeps {
  storageKeys: {
    completion?: string;
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

export async function readCurrentFiledReturnsTargetReview(
  deps: FiledReturnsTargetReviewDeps,
): Promise<FiledReturnsTargetReview | null> {
  const key = deps.storageKeys.targetReview;
  if (!key) return null;

  const values = await browser.storage.local.get(key);
  return parseFiledReturnsTargetReview(values[key]);
}

export async function readCurrentFiledReturnsTargetReviewSummary(
  deps: FiledReturnsTargetReviewDeps,
): Promise<FiledReturnsFlowSummary | null> {
  const review = await readCurrentFiledReturnsTargetReview(deps);
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
): Promise<FiledReturnsFlowSummary | null> {
  const key = deps.storageKeys.targetReview;
  if (!key || !requiresTargetReview(flowStep)) return null;

  const timestamp = (deps.now?.() ?? new Date()).toISOString();
  const review = {
    schemaVersion: "1.0",
    targetId: createTargetId(scope),
    status: "download-unconfirmed",
    scope,
    safeSignals: flowStep.safeSignals,
    safeMessage: flowStep.safeMessage,
    updatedAt: timestamp,
  } satisfies FiledReturnsTargetReview;
  await browser.storage.local.set({
    [key]: review,
  });
  return toTargetReviewSummary(review);
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
  if (hasSinglePeriodCleanupFailure(review.safeSignals)) {
    return responseForFiledReturnsTargetReview(review);
  }

  await clearFiledReturnsTargetReview(scope, deps);
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: filedReturnScopeId(scope.returnType),
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
  const flowSummary: FiledReturnsFlowSummary = {
    scope,
    status: resolution === "downloaded" ? "complete" : "cancelled",
    completedPeriods: resolution === "downloaded" ? [scope.period] : [],
    totalPeriods: 1,
    updatedAt: (deps.now?.() ?? new Date()).toISOString(),
    flowStep,
  };
  await persistResolvedTargetReviewSummary(flowSummary, deps);
  return {
    ok: true,
    flowStep,
    flowSummary,
  };
}

export async function retryCompletedSinglePeriodZipCleanup(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsTargetReviewDeps,
): Promise<PackMessageResponse | null> {
  const review = await readFiledReturnsTargetReview(scope, deps);
  if (!review || !hasSinglePeriodCleanupFailure(review.safeSignals)) return null;

  let stagingRecord;
  try {
    stagingRecord = await readSinglePeriodStagingRecord();
  } catch {
    return responseForFiledReturnsTargetReview(review);
  }
  const clearSignal = stagingRecord
    ? await discardSinglePeriodFiledReturnsZip(stagingRecord.ledgerId)
    : "single-period-opfs-cleared";
  if (clearSignal !== "single-period-opfs-cleared") {
    return responseForFiledReturnsTargetReview(review);
  }

  await clearFiledReturnsTargetReview(scope, deps);
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: filedReturnScopeId(scope.returnType),
    state: "downloaded",
    safeSignals: [
      "single-period-zip-downloaded",
      "single-period-opfs-cleanup-completed",
      clearSignal,
    ],
    safeMessage:
      "Pack kept the completed selected-file ZIP and cleared its temporary local staging.",
  };
  const flowSummary: FiledReturnsFlowSummary = {
    scope,
    status: "complete",
    completedPeriods: [scope.period],
    totalPeriods: 1,
    updatedAt: (deps.now?.() ?? new Date()).toISOString(),
    flowStep,
  };
  await persistResolvedTargetReviewSummary(flowSummary, deps);
  return { ok: true, flowStep, flowSummary };
}

async function persistResolvedTargetReviewSummary(
  flowSummary: FiledReturnsFlowSummary,
  deps: FiledReturnsTargetReviewDeps,
): Promise<void> {
  const key = deps.storageKeys.completion;
  if (!key) return;
  await browser.storage.session.set({ [key]: flowSummary });
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
    !isFiledReturnsReturnType(review.scope.returnType) ||
    normaliseFiledReturnsArtifactType(review.scope.returnType, review.scope.artifactType) !==
      (review.scope.artifactType ?? "PDF")
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
  if (hasSinglePeriodCleanupFailure(review.safeSignals)) {
    return {
      connectorId: "gst",
      scopeId: filedReturnScopeId(review.scope.returnType),
      state: "blocked",
      safeSignals: ["single-period-opfs-clear-failed", "single-period-opfs-cleanup-required"],
      safeMessage:
        "Pack cannot complete this review while temporary selected-file staging remains uncleared.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Retry so Pack can clear the retained temporary staging before completion.",
        canResume: true,
      },
    };
  }
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(review.scope.returnType),
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

export function noTargetReviewResponse(scope: FiledReturnsDownloadScope): PackMessageResponse {
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: filedReturnScopeId(scope.returnType),
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
  if (hasSinglePeriodCleanupFailure(step.safeSignals)) return true;
  return (
    step.state === "download-unconfirmed" ||
    step.safeSignals.some((signal) =>
      [
        "browser-download-size-unknown",
        "browser-download-not-observed",
        "filed-return-download-trigger-ambiguous",
        "filed-gstr3b-download-trigger-ambiguous",
      ].includes(signal),
    )
  );
}

function hasSinglePeriodCleanupFailure(safeSignals: readonly string[]): boolean {
  return safeSignals.includes("single-period-opfs-clear-failed");
}

function sameFiledReturnsScope(
  left: FiledReturnsDownloadScope,
  right: FiledReturnsDownloadScope,
): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType &&
    artifactSelectionsOverlap(left, right)
  );
}

function artifactSelectionsOverlap(
  left: FiledReturnsDownloadScope,
  right: FiledReturnsDownloadScope,
): boolean {
  const leftArtifacts = concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(left.returnType, left.artifactType),
  );
  const rightArtifacts = concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(right.returnType, right.artifactType),
  );
  return leftArtifacts.some((artifactType) => rightArtifacts.includes(artifactType));
}

function createTargetId(scope: FiledReturnsDownloadScope): string {
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  const baseTargetId = `${scope.returnType}:${scope.financialYear}:${scope.period}`;
  return artifactType === "PDF" ? baseTargetId : `${baseTargetId}:${artifactType}`;
}

function isBoundedString(input: unknown, minLength: number, maxLength: number): input is string {
  return typeof input === "string" && input.length >= minLength && input.length <= maxLength;
}
