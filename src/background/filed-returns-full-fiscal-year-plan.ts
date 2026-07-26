import type {
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTarget,
} from "../connectors/gst/filed-returns-contracts";
import {
  FILED_RETURNS_MONTHS,
  GST_LAUNCH_FINANCIAL_YEAR,
  GST_LAUNCH_MONTH,
  type FiledReturnsMonth,
} from "../connectors/gst/filed-returns-scope";
import { normaliseFiledReturnsArtifactType } from "../connectors/gst/filed-returns-artifacts";

export const FULL_FISCAL_YEAR_PLAN_VERSION = "filed-returns-monthly-v2";

export function canonicalFullFiscalYearPlanPeriods(
  financialYear: string,
  eligibleThrough: unknown,
): FiledReturnsMonth[] | null {
  if (!isFiledReturnsMonth(eligibleThrough)) return null;
  const availableMonths =
    financialYear === GST_LAUNCH_FINANCIAL_YEAR
      ? FILED_RETURNS_MONTHS.slice(FILED_RETURNS_MONTHS.indexOf(GST_LAUNCH_MONTH))
      : FILED_RETURNS_MONTHS;
  const eligibleIndex = availableMonths.indexOf(eligibleThrough);
  return eligibleIndex < 0 ? null : availableMonths.slice(0, eligibleIndex + 1);
}

export function hasCanonicalFullFiscalYearTargetPlan(
  ledger: Pick<
    FiledReturnsFullFiscalYearLedger,
    "eligibleThrough" | "planVersion" | "scope" | "targets"
  >,
): boolean {
  if (ledger.planVersion !== FULL_FISCAL_YEAR_PLAN_VERSION) return false;
  const periods = canonicalFullFiscalYearPlanPeriods(
    ledger.scope.financialYear,
    ledger.eligibleThrough,
  );
  return Boolean(periods && targetsMatchPeriods(ledger, periods));
}

export function hasLegacyCanonicalFullFiscalYearTargetPrefix(
  ledger: Pick<
    FiledReturnsFullFiscalYearLedger,
    "eligibleThrough" | "planVersion" | "scope" | "targets"
  >,
): boolean {
  if (ledger.planVersion !== undefined || ledger.eligibleThrough !== undefined) return false;
  const maximumPeriods = canonicalFullFiscalYearPlanPeriods(ledger.scope.financialYear, "March");
  return Boolean(
    maximumPeriods &&
    ledger.targets.length > 0 &&
    ledger.targets.length <= maximumPeriods.length &&
    targetsMatchPeriods(ledger, maximumPeriods.slice(0, ledger.targets.length)),
  );
}

export function isCanonicalFullFiscalYearPeriodPlan(
  financialYear: string,
  periods: readonly FiledReturnsMonth[],
): boolean {
  const eligibleThrough = periods.at(-1);
  const canonical = canonicalFullFiscalYearPlanPeriods(financialYear, eligibleThrough);
  return Boolean(
    canonical &&
    canonical.length === periods.length &&
    canonical.every((period, index) => period === periods[index]),
  );
}

export function targetsMatchPeriods(
  ledger: Pick<FiledReturnsFullFiscalYearLedger, "scope" | "targets">,
  periods: readonly FiledReturnsMonth[],
): boolean {
  return (
    ledger.targets.length === periods.length &&
    ledger.targets.every((target, index) =>
      targetMatchesPlanPeriod(target, ledger.scope, periods[index]),
    )
  );
}

function targetMatchesPlanPeriod(
  target: FiledReturnsFullFiscalYearTarget,
  scope: FiledReturnsFullFiscalYearLedger["scope"],
  period: FiledReturnsMonth | undefined,
): boolean {
  if (!period || target.period !== period) return false;
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  const baseId = `${scope.returnType}:${scope.financialYear}:${period}`;
  const targetId = artifactType === "PDF" ? baseId : `${baseId}:${artifactType}`;
  return (
    target.targetId === targetId &&
    target.financialYear === scope.financialYear &&
    target.returnType === scope.returnType &&
    normaliseFiledReturnsArtifactType(target.returnType, target.artifactType) === artifactType
  );
}

function isFiledReturnsMonth(input: unknown): input is FiledReturnsMonth {
  return typeof input === "string" && FILED_RETURNS_MONTHS.includes(input as FiledReturnsMonth);
}
