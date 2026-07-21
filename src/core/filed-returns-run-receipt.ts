import type { FiledReturnsFullFiscalYearLedger, FiledReturnsDownloadScope } from "./contracts";
import {
  isFiledReturnsConcreteArtifactType,
  normaliseFiledReturnsArtifactType,
  concreteFiledReturnsArtifactTypes,
  type FiledReturnsConcreteArtifactType,
} from "./filed-returns-artifacts";
import {
  isFiledReturnsReturnType,
  type FiledReturnsReturnType,
} from "./filed-returns-return-types";

const RECEIPT_PERIODS = new Set([
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
]);

export interface FiledReturnsRunReceiptV1 {
  schemaVersion: "1.0";
  createdAt: string;
  archiveScope: "single-period" | "custom-range" | "full-fiscal-year";
  returnType: FiledReturnsReturnType;
  financialYear: string;
  artifactTypes: FiledReturnsConcreteArtifactType[];
  targetCount: number;
  artifactCount: number;
  targets: Array<{
    targetId: string;
    period: string;
    status: "prepared" | "not-filed";
  }>;
}

export function createSinglePeriodFiledReturnsReceipt(
  scope: FiledReturnsDownloadScope,
  createdAt = new Date(),
): FiledReturnsRunReceiptV1 {
  const artifactTypes = concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
  );
  return {
    schemaVersion: "1.0",
    createdAt: createdAt.toISOString(),
    archiveScope: "single-period",
    returnType: scope.returnType,
    financialYear: scope.financialYear,
    artifactTypes,
    targetCount: 1,
    artifactCount: artifactTypes.length,
    targets: [
      {
        targetId: receiptTargetId(scope.returnType, scope.financialYear, scope.period),
        period: scope.period,
        status: "prepared",
      },
    ],
  };
}

export function createFullFiscalYearFiledReturnsReceipt(
  ledger: FiledReturnsFullFiscalYearLedger,
  createdAt = new Date(),
): FiledReturnsRunReceiptV1 {
  const targets = ledger.targets.map((target) => ({
    targetId: target.targetId,
    period: target.period,
    status: target.status === "not-filed" ? ("not-filed" as const) : ("prepared" as const),
  }));
  const artifactTypes = concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(ledger.scope.returnType, ledger.scope.artifactType),
  );
  const artifactCount = ledger.targets.reduce((count, target) => {
    if (target.status === "not-filed") return count;
    return (
      count +
      artifactTypes.filter(
        (artifactType) =>
          !target.safeSignals.includes(`filed-return-artifact-unavailable:${artifactType}`),
      ).length
    );
  }, 0);
  return {
    schemaVersion: "1.0",
    createdAt: createdAt.toISOString(),
    archiveScope: ledger.scope.rangeEndPeriod ? "custom-range" : "full-fiscal-year",
    returnType: ledger.scope.returnType,
    financialYear: ledger.scope.financialYear,
    artifactTypes,
    targetCount: targets.length,
    artifactCount,
    targets,
  };
}

export function isFiledReturnsRunReceiptV1(value: unknown): value is FiledReturnsRunReceiptV1 {
  if (
    !isRecordWithOnlyKeys(value, [
      "schemaVersion",
      "createdAt",
      "archiveScope",
      "returnType",
      "financialYear",
      "artifactTypes",
      "targetCount",
      "artifactCount",
      "targets",
    ]) ||
    value.schemaVersion !== "1.0" ||
    !isTimestamp(value.createdAt) ||
    (value.archiveScope !== "single-period" &&
      value.archiveScope !== "custom-range" &&
      value.archiveScope !== "full-fiscal-year") ||
    !isFiledReturnsReturnType(value.returnType) ||
    !isFinancialYear(value.financialYear) ||
    !isUniqueConcreteArtifactTypes(value.artifactTypes) ||
    !isBoundedCount(value.targetCount, 1, 12) ||
    !isBoundedCount(value.artifactCount, 0, 24) ||
    !Array.isArray(value.targets) ||
    value.targets.length !== value.targetCount
  ) {
    return false;
  }
  const receipt = value as unknown as FiledReturnsRunReceiptV1;
  if (
    !receipt.targets.every((target) =>
      isReceiptTarget(target, receipt.returnType, receipt.financialYear),
    )
  ) {
    return false;
  }
  const preparedTargetCount = receipt.targets.filter(
    (target) => target.status === "prepared",
  ).length;
  return (
    receipt.artifactCount >= preparedTargetCount && receipt.artifactCount <= preparedTargetCount * 2
  );
}

function receiptTargetId(returnType: string, financialYear: string, period: string): string {
  return `${returnType}:${financialYear}:${period}`;
}

function isReceiptTarget(
  value: unknown,
  returnType: FiledReturnsReturnType,
  financialYear: string,
): value is FiledReturnsRunReceiptV1["targets"][number] {
  if (!isRecordWithOnlyKeys(value, ["targetId", "period", "status"])) return false;
  if (
    !isBoundedString(value.targetId, 1, 160) ||
    !isBoundedString(value.period, 1, 40) ||
    !RECEIPT_PERIODS.has(value.period)
  ) {
    return false;
  }
  const targetIdPrefix = `${returnType}:${financialYear}:${value.period}`;
  return (
    (value.targetId === targetIdPrefix ||
      (value.targetId.startsWith(`${targetIdPrefix}:`) &&
        /^(?:PDF|EXCEL|PDF_AND_EXCEL)$/.test(value.targetId.slice(targetIdPrefix.length + 1)))) &&
    (value.status === "prepared" || value.status === "not-filed")
  );
}

function isUniqueConcreteArtifactTypes(
  value: unknown,
): value is FiledReturnsConcreteArtifactType[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 2 &&
    value.every(isFiledReturnsConcreteArtifactType) &&
    new Set(value).size === value.length
  );
}

function isRecordWithOnlyKeys(
  value: unknown,
  allowedKeys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowedKeys.includes(key))
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function isFinancialYear(value: unknown): value is string {
  return typeof value === "string" && /^20\d{2}-\d{2}$/.test(value);
}

function isBoundedCount(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max;
}
