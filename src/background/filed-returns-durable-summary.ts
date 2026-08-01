import type { UserActionRequired } from "../core/contracts";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  FiledReturnsFullFiscalYearTargetStatus,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import {
  concreteFiledReturnsArtifactTypes,
  isFiledReturnsConcreteArtifactType,
  normaliseFiledReturnsArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import { isCanonicalFiledReturnsActionId } from "../connectors/gst/filed-returns-operation-id";
import { filedReturnsScopeId } from "../connectors/gst/filed-returns-return-types";
import {
  FILED_RETURNS_MONTHS,
  FULL_FISCAL_YEAR_PERIOD,
} from "../connectors/gst/filed-returns-scope";
import { isCanonicalFullFiscalYearLedgerId } from "../connectors/gst/filed-returns-ledger-id";
import {
  canonicalDurableSummaryMessage,
  gstr1PeriodMismatchRecoveryUserAction,
  parseDurableFiledReturnsScope,
  visibleGstr1MismatchPeriod,
} from "../connectors/gst/filed-returns-durable-status";
import { parseDurableFiledReturnsSignals } from "../connectors/gst/filed-returns-durable-signals";
import {
  copyFiledReturnsDownloadDiagnosticState,
  hasPositiveFiledReturnsDownloadEvidence,
  isValidFiledReturnsDownloadDiagnosticState,
} from "./filed-returns-download-diagnostic-state";

const SUMMARY_KEYS = [
  "artifactAcquisitionCompletion",
  "completedAt",
  "completedPeriods",
  "currentPeriod",
  "flowStep",
  "fullFiscalYearRecovery",
  "scope",
  "status",
  "totalPeriods",
  "updatedAt",
] as const;
const FLOW_STEP_KEYS = [
  "connectorId",
  "downloadDiagnostic",
  "downloadDiagnostics",
  "safeMessage",
  "safeSignals",
  "scopeId",
  "state",
  "userAction",
] as const;
const SUMMARY_STATUSES = new Set<FiledReturnsFlowSummary["status"]>([
  "blocked",
  "cancelled",
  "complete",
  "partial",
  "running",
]);
const FLOW_STATES = new Set<PortalFlowStepResult["state"]>([
  "blocked",
  "candidate-not-found",
  "clicked",
  "download-unconfirmed",
  "downloaded",
  "login-required",
  "partial",
  "ready",
  "unsupported-page",
  "user-action-required",
]);
const TARGET_STATUSES = new Set<FiledReturnsFullFiscalYearTargetStatus>([
  "blocked",
  "cancelled",
  "download-unconfirmed",
  "downloaded",
  "failed",
  "manually-observed",
  "not-filed",
  "pending",
  "running",
]);

export function parseDurableFiledReturnsFlowSummary(
  input: unknown,
): FiledReturnsFlowSummary | null {
  if (!input || typeof input !== "object") return null;
  const summary = input as Partial<FiledReturnsFlowSummary> & Record<string, unknown>;
  if (!hasOnlyKeys(summary, SUMMARY_KEYS)) return null;
  const scope = parseDurableFiledReturnsScope(summary.scope, true);
  if (!scope || !summary.status || !SUMMARY_STATUSES.has(summary.status)) return null;
  const completedPeriods = parsePeriods(summary.completedPeriods);
  if (!completedPeriods || !isOptionalCount(summary.totalPeriods)) return null;
  const artifactAcquisitionCompletion = parseArtifactAcquisitionCompletion(
    summary.artifactAcquisitionCompletion,
    scope,
  );
  if (summary.artifactAcquisitionCompletion !== undefined && !artifactAcquisitionCompletion) {
    return null;
  }
  if (!isOptionalCurrentPeriod(summary.currentPeriod, scope)) return null;
  if (!isOptionalCanonicalTimestamp(summary.completedAt)) return null;
  if (!isOptionalCanonicalTimestamp(summary.updatedAt)) return null;
  if (summary.completedAt === undefined && summary.updatedAt === undefined) return null;
  const recovery = parseRecovery(summary.fullFiscalYearRecovery, scope, summary.currentPeriod);
  if (summary.fullFiscalYearRecovery !== undefined && !recovery) return null;
  const flowStep = parseDurableFlowStep(
    summary.flowStep,
    scope,
    summary.status,
    summary.currentPeriod,
  );
  if (!flowStep) return null;
  if (
    artifactAcquisitionCompletion &&
    (summary.status !== "complete" ||
      !flowStep.safeSignals.includes("artifact-acquisition-download-reconciled"))
  ) {
    return null;
  }
  if (
    summary.status === "complete" &&
    !isConsistentCompleteSummary({
      completedPeriods,
      currentPeriod: summary.currentPeriod,
      flowStep,
      recovery,
      scope,
      totalPeriods: summary.totalPeriods,
    })
  ) {
    return null;
  }
  return {
    scope,
    status: summary.status,
    ...(artifactAcquisitionCompletion ? { artifactAcquisitionCompletion } : {}),
    ...(summary.completedAt ? { completedAt: summary.completedAt } : {}),
    ...(summary.updatedAt ? { updatedAt: summary.updatedAt } : {}),
    completedPeriods,
    ...(summary.totalPeriods !== undefined ? { totalPeriods: summary.totalPeriods } : {}),
    ...(summary.currentPeriod ? { currentPeriod: summary.currentPeriod } : {}),
    ...(recovery ? { fullFiscalYearRecovery: recovery } : {}),
    flowStep,
  };
}

function parseArtifactAcquisitionCompletion(
  input: unknown,
  scope: FiledReturnsDownloadScope,
): FiledReturnsFlowSummary["artifactAcquisitionCompletion"] | null {
  if (!Array.isArray(input)) return null;
  const expectedArtifacts = concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
  );
  if (input.length !== expectedArtifacts.length) return null;
  const completion = input.map((entry, index) => {
    if (!entry || typeof entry !== "object") return null;
    const value = entry as Record<string, unknown>;
    if (
      !hasOnlyKeys(value, ["artifactType", "requestId"]) ||
      !isFiledReturnsConcreteArtifactType(value.artifactType) ||
      value.artifactType !== expectedArtifacts[index] ||
      !isCanonicalFiledReturnsActionId(value.requestId)
    ) {
      return null;
    }
    return { artifactType: value.artifactType, requestId: value.requestId };
  });
  return completion.some((entry) => entry === null)
    ? null
    : (completion as NonNullable<FiledReturnsFlowSummary["artifactAcquisitionCompletion"]>);
}

function isConsistentCompleteSummary({
  completedPeriods,
  currentPeriod,
  flowStep,
  recovery,
  scope,
  totalPeriods,
}: {
  completedPeriods: string[];
  currentPeriod: string | undefined;
  flowStep: PortalFlowStepResult;
  recovery: FiledReturnsFlowSummary["fullFiscalYearRecovery"] | null;
  scope: FiledReturnsDownloadScope;
  totalPeriods: number | undefined;
}): boolean {
  if (totalPeriods === undefined || completedPeriods.length !== totalPeriods || recovery) {
    return false;
  }
  if (scope.period === FULL_FISCAL_YEAR_PERIOD) {
    return (
      flowStep.state === "downloaded" &&
      currentPeriod === undefined &&
      flowStep.safeSignals.includes("full-fiscal-year-complete")
    );
  }
  if (
    totalPeriods !== 1 ||
    currentPeriod !== scope.period ||
    completedPeriods.length !== 1 ||
    completedPeriods[0] !== scope.period
  ) {
    return false;
  }
  if (flowStep.safeSignals.includes("filed-return-positively-not-filed")) {
    return (
      flowStep.state === "candidate-not-found" &&
      flowStep.downloadDiagnostic === undefined &&
      flowStep.downloadDiagnostics === undefined
    );
  }
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  const isSelectedArtifactBundle = artifactType === "PDF_AND_EXCEL";
  const hasExactArtifactReconciliation = hasExactArtifactAcquisitionReconciliationEvidence(
    scope,
    flowStep.safeSignals,
  );
  return (
    flowStep.state === "downloaded" &&
    (hasExactArtifactReconciliation ||
      ((isSelectedArtifactBundle
        ? flowStep.safeSignals.includes("single-period-zip-downloaded")
        : true) &&
        hasPositiveFiledReturnsDownloadEvidence(
          flowStep,
          scope,
          flowStep.safeSignals,
          isSelectedArtifactBundle ? "single-period" : null,
        )))
  );
}

function hasExactArtifactAcquisitionReconciliationEvidence(
  scope: FiledReturnsDownloadScope,
  safeSignals: readonly string[],
): boolean {
  const expectedArtifactCount = concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
  ).length;
  const downloadIds = safeSignals.filter((signal) => /^browser-download-id:\d{1,10}$/.test(signal));
  return (
    safeSignals.includes("artifact-acquisition-download-reconciled") &&
    safeSignals.includes("browser-download-created") &&
    safeSignals.includes("browser-download-completed") &&
    safeSignals.includes("browser-download-non-empty") &&
    downloadIds.length === expectedArtifactCount &&
    new Set(downloadIds).size === expectedArtifactCount
  );
}

function parseDurableFlowStep(
  input: unknown,
  scope: FiledReturnsDownloadScope,
  summaryStatus: FiledReturnsFlowSummary["status"],
  currentPeriod?: string,
): PortalFlowStepResult | null {
  if (!input || typeof input !== "object") return null;
  const step = input as Partial<PortalFlowStepResult> & Record<string, unknown>;
  if (!hasOnlyKeys(step, FLOW_STEP_KEYS)) return null;
  if (step.connectorId !== "gst" || step.scopeId !== filedReturnsScopeId(scope.returnType)) {
    return null;
  }
  if (!step.state || !FLOW_STATES.has(step.state)) return null;
  if (typeof step.safeMessage !== "string" || step.safeMessage.length > 500) return null;
  const safeSignals = parseDurableFiledReturnsSignals(step.safeSignals);
  if (!safeSignals) return null;
  const parsedUserAction = parseUserAction(step.userAction);
  if (step.userAction !== undefined && !parsedUserAction) return null;
  const userAction = shouldUseGstr1MismatchRecoveryAction(
    scope,
    summaryStatus,
    safeSignals,
    parsedUserAction,
  )
    ? gstr1PeriodMismatchRecoveryUserAction(scope)
    : parsedUserAction;
  const diagnosticScope =
    scope.period === FULL_FISCAL_YEAR_PERIOD && currentPeriod
      ? { ...scope, period: currentPeriod }
      : scope;
  if (!isValidFiledReturnsDownloadDiagnosticState(step, diagnosticScope)) return null;
  return {
    connectorId: "gst",
    scopeId: filedReturnsScopeId(scope.returnType),
    state: step.state,
    safeSignals,
    safeMessage: canonicalDurableSummaryMessage(scope, summaryStatus, safeSignals),
    ...(userAction ? { userAction } : {}),
    ...copyFiledReturnsDownloadDiagnosticState(step),
  };
}

function shouldUseGstr1MismatchRecoveryAction(
  scope: FiledReturnsDownloadScope,
  summaryStatus: FiledReturnsFlowSummary["status"],
  safeSignals: readonly string[],
  action: UserActionRequired | null,
): boolean {
  if (!visibleGstr1MismatchPeriod(scope, summaryStatus, safeSignals)) return false;
  if (!action || action.type === "NAVIGATE_TO_SUPPORTED_PAGE") return true;
  return (
    action.type === "WAIT_FOR_PORTAL_AVAILABILITY" &&
    safeSignals.includes("flow-step-limit-reached")
  );
}

function parseRecovery(
  input: unknown,
  scope: FiledReturnsDownloadScope,
  currentPeriod: unknown,
): FiledReturnsFlowSummary["fullFiscalYearRecovery"] | null {
  if (input === undefined) return null;
  if (!input || typeof input !== "object" || scope.period !== FULL_FISCAL_YEAR_PERIOD) return null;
  const recovery = input as Record<string, unknown>;
  if (!hasOnlyKeys(recovery, ["expectedRevision", "ledgerId", "targetId", "targetStatus"])) {
    return null;
  }
  if (!isCanonicalFullFiscalYearLedgerId(recovery.ledgerId) || typeof currentPeriod !== "string") {
    return null;
  }
  if (recovery.targetId !== targetIdFor(scope, currentPeriod)) return null;
  if (
    !Number.isSafeInteger(recovery.expectedRevision) ||
    (recovery.expectedRevision as number) < 1 ||
    (recovery.expectedRevision as number) > 10_000
  ) {
    return null;
  }
  if (
    typeof recovery.targetStatus !== "string" ||
    !TARGET_STATUSES.has(recovery.targetStatus as FiledReturnsFullFiscalYearTargetStatus)
  ) {
    return null;
  }
  return {
    expectedRevision: recovery.expectedRevision as number,
    ledgerId: recovery.ledgerId,
    targetId: recovery.targetId as string,
    targetStatus: recovery.targetStatus as FiledReturnsFullFiscalYearTargetStatus,
  };
}

function parseUserAction(input: unknown): UserActionRequired | null {
  if (input === undefined) return null;
  if (!input || typeof input !== "object") return null;
  const action = input as Partial<UserActionRequired> & Record<string, unknown>;
  if (!hasOnlyKeys(action, ["canResume", "message", "type"])) return null;
  if (typeof action.canResume !== "boolean" || typeof action.message !== "string") return null;
  const messages: Record<UserActionRequired["type"], string> = {
    ALLOW_MULTIPLE_DOWNLOADS: "Allow browser downloads for the GST Portal, then retry.",
    COMPLETE_CAPTCHA: "Complete the GST Portal CAPTCHA, then retry.",
    COMPLETE_OTP: "Complete the GST Portal OTP step, then retry.",
    LOGIN: "Sign in to the GST Portal, then retry.",
    NAVIGATE_TO_SUPPORTED_PAGE: "Open the requested filed-return page, then retry.",
    RETRY_PORTAL_GENERATION: "Review the saved target state, then choose an explicit retry.",
    WAIT_FOR_PORTAL_AVAILABILITY: "Wait for the GST Portal to become available, then retry.",
  };
  if (typeof action.type !== "string" || !Object.hasOwn(messages, action.type)) return null;
  const type = action.type as UserActionRequired["type"];
  return { type, message: messages[type], canResume: action.canResume };
}

function targetIdFor(scope: FiledReturnsDownloadScope, period: string): string {
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  const base = `${scope.returnType}:${scope.financialYear}:${period}`;
  return artifactType === "PDF" ? base : `${base}:${artifactType}`;
}

function parsePeriods(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length > FILED_RETURNS_MONTHS.length) return null;
  if (!input.every((period) => FILED_RETURNS_MONTHS.includes(period as never))) return null;
  return new Set(input).size === input.length ? [...input] : null;
}

function isOptionalCount(input: unknown): boolean {
  return (
    input === undefined ||
    (Number.isSafeInteger(input) && (input as number) >= 1 && (input as number) <= 12)
  );
}

function isOptionalCurrentPeriod(input: unknown, scope: FiledReturnsDownloadScope): boolean {
  if (input === undefined) return true;
  if (typeof input !== "string" || !FILED_RETURNS_MONTHS.includes(input as never)) return false;
  return scope.period === FULL_FISCAL_YEAR_PERIOD || scope.period === input;
}

function isOptionalCanonicalTimestamp(input: unknown): input is string | undefined {
  if (input === undefined) return true;
  if (typeof input !== "string" || input.length > 40) return false;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === input;
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}
