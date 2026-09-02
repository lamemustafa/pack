import type {
  FiledReturnsAllSupportedFullFiscalYearIdentity,
  FiledReturnsDownloadDiagnostic,
  FiledReturnsFullFiscalYearTargetStatus,
} from "../connectors/gst/filed-returns-contracts";
import type {
  FiledReturnsArtifactType,
  FiledReturnsConcreteArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import {
  FILED_RETURNS_CONCRETE_ARTIFACT_TYPES,
  isFiledReturnsArtifactType,
  isFiledReturnsConcreteArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import {
  isAllSupportedFullFiscalYearRequest,
  type FiledReturnsAllSupportedFullFiscalYearPlanTarget,
} from "../connectors/gst/filed-returns-all-supported-full-fiscal-year";
import {
  isFiledReturnsReturnType,
  type FiledReturnsReturnType,
} from "../connectors/gst/filed-returns-return-types";
import {
  FILED_RETURNS_MONTHS,
  type FiledReturnsMonth,
} from "../connectors/gst/filed-returns-scope";
import {
  isHistoricalDurableTargetMessage,
  parseDurableTargetStatus,
} from "../connectors/gst/filed-returns-durable-status";
import { isCanonicalFullFiscalYearLedgerId } from "../connectors/gst/filed-returns-ledger-id";
import {
  hasPositiveFiledReturnsDownloadEvidence,
  isValidFiledReturnsDownloadDiagnosticState,
} from "./filed-returns-download-diagnostic-state";
import { canonicalFullFiscalYearPlanPeriods } from "./filed-returns-full-fiscal-year-validation";

export const ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_VERSION =
  "all-supported-filed-returns-targets-v1" as const;
export const ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_PROVENANCE_VERSION = "1.0" as const;
export const ALL_SUPPORTED_FULL_FISCAL_YEAR_CATALOGUE_VERSION =
  "gst-filed-returns-catalogue-v1" as const;

/**
 * The return-level catalogue snapshot captured when a plan is created. It is
 * deliberately separate from the period-level target plan: the latter proves
 * every planned period still belongs to this exact historical return set.
 */
export interface FiledReturnsAllSupportedFullFiscalYearPlanProvenance {
  schemaVersion: typeof ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_PROVENANCE_VERSION;
  catalogueVersion: typeof ALL_SUPPORTED_FULL_FISCAL_YEAR_CATALOGUE_VERSION;
  returnPlan: FiledReturnsAllSupportedFullFiscalYearPlanTarget[];
}

// This registry is the trusted historical membership authority. When the live
// catalogue changes, retain this entry and add a new version; never rewrite a
// version that can already occur in persisted storage.
const HISTORICAL_RETURN_PLANS = {
  "gst-filed-returns-catalogue-v1": [
    {
      returnType: "GSTR-3B",
      artifactType: "PDF_AND_EXCEL",
      concreteArtifactTypes: ["PDF", "JSON"],
    },
    {
      returnType: "GSTR-1",
      artifactType: "PDF_AND_EXCEL",
      concreteArtifactTypes: ["PDF", "EXCEL"],
    },
    {
      returnType: "GSTR-2B",
      artifactType: "PDF_AND_EXCEL",
      concreteArtifactTypes: ["PDF", "EXCEL", "JSON"],
    },
  ],
} as const satisfies Record<
  typeof ALL_SUPPORTED_FULL_FISCAL_YEAR_CATALOGUE_VERSION,
  readonly FiledReturnsAllSupportedFullFiscalYearPlanTarget[]
>;

export interface FiledReturnsAllSupportedFullFiscalYearLedgerPlanTarget extends FiledReturnsAllSupportedFullFiscalYearPlanTarget {
  targetId: string;
  financialYear: string;
  period: FiledReturnsMonth;
}

export interface FiledReturnsAllSupportedFullFiscalYearTarget extends FiledReturnsAllSupportedFullFiscalYearLedgerPlanTarget {
  status: FiledReturnsFullFiscalYearTargetStatus;
  attempts: number;
  safeSignals: string[];
  safeMessage: string;
  downloadDiagnostic?: FiledReturnsDownloadDiagnostic;
  downloadDiagnostics?: FiledReturnsDownloadDiagnostic[];
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface FiledReturnsAllSupportedFullFiscalYearLedger {
  schemaVersion: "2.0";
  planVersion: typeof ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_VERSION;
  connectorVersion: string;
  createdWithExtensionVersion: string;
  ledgerId: string;
  revision: number;
  status: "running" | "complete" | "partial" | "blocked" | "cancelled";
  zipPhase?: AllSupportedFullFiscalYearZipPhase;
  zipDownloadAttempt?: { requestedAt: string; downloadId?: number };
  planRoot: FiledReturnsAllSupportedFullFiscalYearIdentity;
  currentTargetId?: string;
  portalTabId?: number;
  portalTabSessionId?: string;
  createdAt: string;
  updatedAt: string;
  eligibleThrough: FiledReturnsMonth;
  lastReconciledAt: string;
  planProvenance: FiledReturnsAllSupportedFullFiscalYearPlanProvenance;
  targetPlan: FiledReturnsAllSupportedFullFiscalYearLedgerPlanTarget[];
  targets: FiledReturnsAllSupportedFullFiscalYearTarget[];
}

export type AllSupportedFullFiscalYearZipPhase =
  | "export-pending"
  | "export-retry-pending"
  | "download-intent-persisted"
  | "download-observing"
  | "download-started"
  | "restaging-required"
  | "downloaded-cleanup-pending"
  | "no-artifacts-cleanup-pending"
  | "legacy-cleanup-pending"
  | "cleaned-after-download"
  | "cleaned-without-export"
  | "cleaned-legacy"
  | "cleaned";

const MAX_SAFE_MESSAGE_LENGTH = 500;
const TARGET_STATUSES = new Set<FiledReturnsFullFiscalYearTargetStatus>([
  "pending",
  "running",
  "downloaded",
  "manually-observed",
  "not-filed",
  "download-unconfirmed",
  "blocked",
  "failed",
  "cancelled",
]);
const POSITIVE_TARGET_STATUSES = new Set<FiledReturnsFullFiscalYearTargetStatus>([
  "downloaded",
  "not-filed",
]);
const ZIP_PHASES = new Set<AllSupportedFullFiscalYearZipPhase>([
  "export-pending",
  "export-retry-pending",
  "download-intent-persisted",
  "download-observing",
  "download-started",
  "restaging-required",
  "downloaded-cleanup-pending",
  "no-artifacts-cleanup-pending",
  "legacy-cleanup-pending",
  "cleaned-after-download",
  "cleaned-without-export",
  "cleaned-legacy",
  "cleaned",
]);
const CLEANED_ZIP_PHASES = new Set<AllSupportedFullFiscalYearZipPhase>([
  "cleaned-after-download",
  "cleaned-without-export",
  "cleaned-legacy",
  "cleaned",
]);
const ZIP_PHASES_REQUIRING_COMPLETED_TARGETS = new Set<AllSupportedFullFiscalYearZipPhase>([
  "export-pending",
  "export-retry-pending",
  "download-intent-persisted",
  "download-observing",
  "download-started",
  "downloaded-cleanup-pending",
  "no-artifacts-cleanup-pending",
  "legacy-cleanup-pending",
  ...CLEANED_ZIP_PHASES,
]);
const LEDGER_KEYS = [
  "connectorVersion",
  "createdAt",
  "createdWithExtensionVersion",
  "currentTargetId",
  "eligibleThrough",
  "lastReconciledAt",
  "ledgerId",
  "planRoot",
  "planProvenance",
  "planVersion",
  "portalTabId",
  "portalTabSessionId",
  "revision",
  "schemaVersion",
  "status",
  "targetPlan",
  "targets",
  "updatedAt",
  "zipDownloadAttempt",
  "zipPhase",
] as const;
const PLAN_PROVENANCE_KEYS = ["catalogueVersion", "schemaVersion", "returnPlan"] as const;
const RETURN_PLAN_TARGET_KEYS = ["artifactType", "concreteArtifactTypes", "returnType"] as const;
const PLAN_TARGET_KEYS = [
  "artifactType",
  "concreteArtifactTypes",
  "financialYear",
  "period",
  "returnType",
  "targetId",
] as const;
const TARGET_KEYS = [
  ...PLAN_TARGET_KEYS,
  "attempts",
  "completedAt",
  "downloadDiagnostic",
  "downloadDiagnostics",
  "safeMessage",
  "safeSignals",
  "startedAt",
  "status",
  "updatedAt",
] as const;

export function isAllSupportedFullFiscalYearLedger(
  input: unknown,
): input is FiledReturnsAllSupportedFullFiscalYearLedger {
  if (!isRecord(input) || !hasOnlyKeys(input, LEDGER_KEYS)) return false;
  const ledger = input as Partial<FiledReturnsAllSupportedFullFiscalYearLedger>;
  if (
    ledger.schemaVersion !== "2.0" ||
    ledger.planVersion !== ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_VERSION ||
    !isCanonicalFullFiscalYearLedgerId(ledger.ledgerId) ||
    !isAllSupportedFullFiscalYearRequest(ledger.planRoot) ||
    !isConsecutiveFinancialYear(ledger.planRoot.financialYear) ||
    !isSemanticVersion(ledger.connectorVersion) ||
    !isSemanticVersion(ledger.createdWithExtensionVersion) ||
    !isRevision(ledger.revision) ||
    !isLedgerStatus(ledger.status) ||
    !isCanonicalTimestamp(ledger.createdAt) ||
    !isCanonicalTimestamp(ledger.updatedAt) ||
    !isCanonicalTimestamp(ledger.lastReconciledAt) ||
    !isFiledReturnsMonth(ledger.eligibleThrough)
  ) {
    return false;
  }
  if (
    (ledger.portalTabId === undefined) !== (ledger.portalTabSessionId === undefined) ||
    (ledger.portalTabId !== undefined &&
      (!Number.isSafeInteger(ledger.portalTabId) || ledger.portalTabId < 0)) ||
    (ledger.portalTabSessionId !== undefined &&
      !isBoundedString(ledger.portalTabSessionId, 1, 120)) ||
    (ledger.currentTargetId !== undefined && !isBoundedString(ledger.currentTargetId, 1, 120)) ||
    !isValidZipDownloadAttempt(ledger)
  ) {
    return false;
  }
  if (ledger.zipPhase !== undefined && !ZIP_PHASES.has(ledger.zipPhase)) return false;
  if (
    ledger.zipPhase !== undefined &&
    !CLEANED_ZIP_PHASES.has(ledger.zipPhase) &&
    ledger.status !== "blocked"
  )
    return false;
  if (
    ledger.zipPhase !== undefined &&
    CLEANED_ZIP_PHASES.has(ledger.zipPhase) &&
    ledger.status !== "complete"
  )
    return false;
  if (!isPlanProvenance(ledger.planProvenance)) return false;
  const targetPlan = ledger.targetPlan;
  if (
    !isTargetPlan(
      targetPlan,
      ledger.planRoot.financialYear,
      ledger.eligibleThrough,
      ledger.planProvenance,
    )
  )
    return false;
  if (!Array.isArray(ledger.targets) || ledger.targets.length !== targetPlan.length) return false;
  if (!ledger.targets.every((target, index) => isTarget(target, targetPlan[index]))) return false;
  if (
    ledger.currentTargetId !== undefined &&
    !ledger.targets.some((target) => target.targetId === ledger.currentTargetId)
  ) {
    return false;
  }
  return !(
    ledger.zipPhase &&
    ZIP_PHASES_REQUIRING_COMPLETED_TARGETS.has(ledger.zipPhase) &&
    !ledger.targets.every((target) => POSITIVE_TARGET_STATUSES.has(target.status))
  );
}

export function isAllSupportedFullFiscalYearPlanRootKey(
  input: unknown,
): input is FiledReturnsAllSupportedFullFiscalYearIdentity {
  return isAllSupportedFullFiscalYearRequest(input);
}

export function recoverableAllSupportedFullFiscalYearLedgerId(input: unknown): string | null {
  if (!isRecord(input)) return null;
  return isCanonicalFullFiscalYearLedgerId(input.ledgerId) ? input.ledgerId : null;
}

function isTargetPlan(
  input: unknown,
  financialYear: string,
  eligibleThrough: FiledReturnsMonth,
  planProvenance: FiledReturnsAllSupportedFullFiscalYearPlanProvenance,
): input is FiledReturnsAllSupportedFullFiscalYearLedgerPlanTarget[] {
  if (!Array.isArray(input) || input.length === 0) return false;
  const periods = canonicalFullFiscalYearPlanPeriods(financialYear, eligibleThrough);
  if (!periods) return false;
  if (input.length !== planProvenance.returnPlan.length * periods.length) return false;
  let index = 0;
  for (const expectedReturn of planProvenance.returnPlan) {
    for (const period of periods) {
      const target = input[index];
      if (
        !isPlanTarget(target, financialYear) ||
        target.returnType !== expectedReturn.returnType ||
        target.period !== period ||
        target.artifactType !== expectedReturn.artifactType ||
        !sameArtifacts(target.concreteArtifactTypes, expectedReturn.concreteArtifactTypes)
      ) {
        return false;
      }
      index += 1;
    }
  }
  return true;
}

function isPlanProvenance(
  input: unknown,
): input is FiledReturnsAllSupportedFullFiscalYearPlanProvenance {
  if (!isRecord(input) || !hasOnlyKeys(input, PLAN_PROVENANCE_KEYS)) return false;
  const provenance = input as Partial<FiledReturnsAllSupportedFullFiscalYearPlanProvenance>;
  return (
    provenance.schemaVersion === ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_PROVENANCE_VERSION &&
    provenance.catalogueVersion === ALL_SUPPORTED_FULL_FISCAL_YEAR_CATALOGUE_VERSION &&
    isReturnPlan(provenance.returnPlan) &&
    sameReturnPlan(provenance.returnPlan, HISTORICAL_RETURN_PLANS[provenance.catalogueVersion])
  );
}

function sameReturnPlan(
  left: readonly FiledReturnsAllSupportedFullFiscalYearPlanTarget[],
  right: readonly FiledReturnsAllSupportedFullFiscalYearPlanTarget[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (target, index) =>
        target.returnType === right[index]?.returnType &&
        target.artifactType === right[index]?.artifactType &&
        sameArtifacts(target.concreteArtifactTypes, right[index]?.concreteArtifactTypes ?? []),
    )
  );
}

function isReturnPlan(input: unknown): input is FiledReturnsAllSupportedFullFiscalYearPlanTarget[] {
  if (!Array.isArray(input) || input.length === 0) return false;
  const returnTypes = new Set<string>();
  return input.every((target) => {
    if (!isReturnPlanTarget(target) || returnTypes.has(target.returnType)) return false;
    returnTypes.add(target.returnType);
    return true;
  });
}

function isReturnPlanTarget(
  input: unknown,
): input is FiledReturnsAllSupportedFullFiscalYearPlanTarget {
  if (!isRecord(input) || !hasOnlyKeys(input, RETURN_PLAN_TARGET_KEYS)) return false;
  const target = input as Partial<FiledReturnsAllSupportedFullFiscalYearPlanTarget>;
  return (
    isFiledReturnsReturnType(target.returnType) &&
    isFiledReturnsArtifactType(target.artifactType) &&
    hasCanonicalConcreteArtifacts(target.artifactType, target.concreteArtifactTypes)
  );
}

function isPlanTarget(
  input: unknown,
  financialYear: string,
): input is FiledReturnsAllSupportedFullFiscalYearLedgerPlanTarget {
  if (!isRecord(input) || !hasOnlyKeys(input, PLAN_TARGET_KEYS)) return false;
  const target = input as Partial<FiledReturnsAllSupportedFullFiscalYearLedgerPlanTarget>;
  if (
    !isBoundedString(target.targetId, 1, 120) ||
    target.financialYear !== financialYear ||
    !isFiledReturnsMonth(target.period) ||
    !isFiledReturnsReturnType(target.returnType) ||
    !isFiledReturnsArtifactType(target.artifactType) ||
    !hasCanonicalConcreteArtifacts(target.artifactType, target.concreteArtifactTypes)
  ) {
    return false;
  }
  return (
    target.targetId ===
    createAllSupportedFullFiscalYearTargetId(
      target.financialYear,
      target.period,
      target.returnType,
      target.artifactType,
    )
  );
}

function isTarget(
  input: unknown,
  planTarget: FiledReturnsAllSupportedFullFiscalYearLedgerPlanTarget | undefined,
): input is FiledReturnsAllSupportedFullFiscalYearTarget {
  if (!planTarget || !isRecord(input) || !hasOnlyKeys(input, TARGET_KEYS)) return false;
  const target = input as Partial<FiledReturnsAllSupportedFullFiscalYearTarget>;
  if (
    target.targetId !== planTarget.targetId ||
    target.financialYear !== planTarget.financialYear ||
    target.period !== planTarget.period ||
    target.returnType !== planTarget.returnType ||
    target.artifactType !== planTarget.artifactType ||
    !sameArtifacts(target.concreteArtifactTypes, planTarget.concreteArtifactTypes) ||
    !TARGET_STATUSES.has(target.status as FiledReturnsFullFiscalYearTargetStatus) ||
    !isAttemptCount(target.attempts) ||
    !isBoundedString(target.safeMessage, 1, MAX_SAFE_MESSAGE_LENGTH) ||
    !isCanonicalTimestamp(target.updatedAt) ||
    (target.startedAt !== undefined && !isCanonicalTimestamp(target.startedAt)) ||
    (target.completedAt !== undefined && !isCanonicalTimestamp(target.completedAt))
  ) {
    return false;
  }
  const verifiedTarget = target as FiledReturnsAllSupportedFullFiscalYearTarget;
  const scope = targetScope(verifiedTarget);
  const durableStatus = parseDurableTargetStatus(
    scope,
    verifiedTarget.status,
    verifiedTarget.safeSignals,
  );
  if (!durableStatus) return false;
  if (
    verifiedTarget.safeMessage !== durableStatus.safeMessage &&
    !isHistoricalDurableTargetMessage(
      scope,
      verifiedTarget.status,
      durableStatus.safeSignals,
      verifiedTarget.safeMessage,
    )
  ) {
    return false;
  }
  if (!isValidFiledReturnsDownloadDiagnosticState(verifiedTarget, scope)) return false;
  if (
    verifiedTarget.status === "downloaded" &&
    !hasPositiveFiledReturnsDownloadEvidence(
      verifiedTarget,
      scope,
      verifiedTarget.safeSignals,
      "all-supported-full-fiscal-year",
    )
  ) {
    return false;
  }
  return (
    verifiedTarget.status !== "not-filed" ||
    verifiedTarget.safeSignals.includes("filed-return-positively-not-filed")
  );
}

function hasCanonicalConcreteArtifacts(
  artifactType: FiledReturnsArtifactType,
  concreteArtifactTypes: unknown,
): concreteArtifactTypes is readonly FiledReturnsConcreteArtifactType[] {
  if (!Array.isArray(concreteArtifactTypes) || concreteArtifactTypes.length === 0) return false;
  if (!concreteArtifactTypes.every(isFiledReturnsConcreteArtifactType)) return false;
  if (new Set(concreteArtifactTypes).size !== concreteArtifactTypes.length) return false;
  if (
    concreteArtifactTypes.some(
      (artifact, index) =>
        index > 0 &&
        FILED_RETURNS_CONCRETE_ARTIFACT_TYPES.indexOf(artifact) <=
          FILED_RETURNS_CONCRETE_ARTIFACT_TYPES.indexOf(concreteArtifactTypes[index - 1]!),
    )
  ) {
    return false;
  }
  return artifactType === "PDF_AND_EXCEL"
    ? concreteArtifactTypes.length > 1
    : concreteArtifactTypes.length === 1 && concreteArtifactTypes[0] === artifactType;
}

function isValidZipDownloadAttempt(
  ledger: Partial<FiledReturnsAllSupportedFullFiscalYearLedger>,
): boolean {
  const attempt = ledger.zipDownloadAttempt;
  if (attempt === undefined) {
    return !["download-intent-persisted", "download-observing"].includes(ledger.zipPhase ?? "");
  }
  if (
    !isRecord(attempt) ||
    !hasOnlyKeys(attempt, ["requestedAt", "downloadId"]) ||
    !isCanonicalTimestamp(attempt.requestedAt) ||
    (attempt.downloadId !== undefined &&
      (!Number.isSafeInteger(attempt.downloadId) || attempt.downloadId < 0))
  ) {
    return false;
  }
  if (ledger.zipPhase === "download-intent-persisted") return attempt.downloadId === undefined;
  if (ledger.zipPhase === "download-observing") return attempt.downloadId !== undefined;
  return ledger.zipPhase === "downloaded-cleanup-pending" && attempt.downloadId === undefined;
}

function targetScope(
  target: Pick<
    FiledReturnsAllSupportedFullFiscalYearTarget,
    "artifactType" | "financialYear" | "period" | "returnType"
  >,
) {
  return {
    financialYear: target.financialYear,
    period: target.period,
    returnType: target.returnType,
    artifactType: target.artifactType,
  };
}

function sameArtifacts(left: unknown, right: readonly FiledReturnsConcreteArtifactType[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

export function createAllSupportedFullFiscalYearTargetId(
  financialYear: string,
  period: string,
  returnType: FiledReturnsReturnType,
  artifactType: FiledReturnsArtifactType,
): string {
  const base = `${returnType}:${financialYear}:${period}`;
  return artifactType === "PDF" ? base : `${base}:${artifactType}`;
}

function isLedgerStatus(
  input: unknown,
): input is FiledReturnsAllSupportedFullFiscalYearLedger["status"] {
  return ["running", "complete", "partial", "blocked", "cancelled"].includes(input as string);
}

function isRevision(input: unknown): input is number {
  return typeof input === "number" && Number.isInteger(input) && input >= 1 && input <= 10_000;
}

function isAttemptCount(input: unknown): input is number {
  return typeof input === "number" && Number.isInteger(input) && input >= 0 && input <= 100;
}

function isSemanticVersion(input: unknown): input is string {
  return (
    typeof input === "string" &&
    input.length <= 120 &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?$/.test(input)
  );
}

function isCanonicalTimestamp(input: unknown): input is string {
  return (
    typeof input === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input) &&
    new Date(input).toISOString() === input
  );
}

function isFiledReturnsMonth(input: unknown): input is FiledReturnsMonth {
  return typeof input === "string" && FILED_RETURNS_MONTHS.includes(input as FiledReturnsMonth);
}

function isConsecutiveFinancialYear(input: string): boolean {
  const match = /^20(\d{2})-(\d{2})$/.exec(input);
  return match !== null && Number(match[2]) === (Number(match[1]) + 1) % 100;
}

function isBoundedString(input: unknown, min: number, max: number): input is string {
  return typeof input === "string" && input.length >= min && input.length <= max;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasOnlyKeys(input: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(input).every((key) => allowed.has(key));
}
