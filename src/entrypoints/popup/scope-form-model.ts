import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalContext,
} from "../../core/contracts";
import {
  FILED_RETURNS_ARTIFACT_TYPES,
  filedReturnsArtifactLabel,
  normaliseFiledReturnsArtifactType,
  supportsFiledReturnsArtifactType,
} from "../../core/filed-returns-artifacts";
import {
  FILED_RETURNS_MONTHS,
  getFiledReturnsFinancialYearOptions,
  getFiledReturnsPeriodOptions,
  getFiledReturnsScopePeriodOptions,
  FULL_FISCAL_YEAR_PERIOD,
  isFullFiscalYearScope,
} from "../../core/filed-returns-scope";
import { FILED_RETURNS_RETURN_TYPES } from "../../core/filed-returns-return-types";

export function createScopeFormModel(scope: FiledReturnsDownloadScope) {
  const singlePeriodOptions = getFiledReturnsPeriodOptions(scope.financialYear, new Date());
  const scopePeriodOptions = getFiledReturnsScopePeriodOptions(
    scope.financialYear,
    new Date(),
    scope.returnType,
  );
  const fullFiscalYear = isFullFiscalYearScope(scope);
  return {
    artifactOptions: FILED_RETURNS_ARTIFACT_TYPES.filter((artifactType) =>
      supportsFiledReturnsArtifactType(scope.returnType, artifactType),
    ).map((artifactType) => ({
      value: artifactType,
      label: filedReturnsArtifactLabel(artifactType, scope.returnType),
    })),
    financialYearOptions: getFiledReturnsFinancialYearOptions().map((financialYear) => ({
      value: financialYear,
      label: financialYear,
    })),
    fullFiscalYear,
    selectedArtifactType: normaliseFiledReturnsArtifactType(
      scope.returnType,
      scope.artifactType,
    ),
    singlePeriodOptions,
    supportsFullFiscalYear: scopePeriodOptions.some(
      (option) => option.value === FULL_FISCAL_YEAR_PERIOD,
    ),
  };
}

export function returnTypeOptions() {
  return FILED_RETURNS_RETURN_TYPES.map((returnType) => ({
    value: returnType,
    label: returnType,
  }));
}

export function getSinglePeriodFallback(
  period: FiledReturnsDownloadScope["period"],
  options: Array<{ value: string; label: string }>,
): string {
  if (period !== FULL_FISCAL_YEAR_PERIOD) return period;
  return options[0]?.value ?? FILED_RETURNS_MONTHS[0];
}

export function getFullFiscalYearNote(scope: FiledReturnsDownloadScope): string {
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  const base =
    `Runs eligible filed ${scope.returnType} periods one by one from your signed-in GST ` +
    "Portal tab. Pack stops on ambiguous downloads and records local status only.";
  if (scope.returnType === "GSTR-2B" && artifactType === "PDF_AND_EXCEL") {
    return `${base} PDF and Excel are captured only from the portal-generated download controls.`;
  }
  if (scope.returnType === "GSTR-1" && artifactType !== "PDF") {
    return `${base} Excel is included only when the GST Portal provides the selected e-invoice details file.`;
  }
  return base;
}

export function getScopeFormStartAction(
  scope: FiledReturnsDownloadScope,
  summary: FiledReturnsFlowSummary | null | undefined,
  busy: string | null,
  fullFiscalYear: boolean,
  context: PortalContext | null,
): { disabled: boolean; label: string } {
  if (busy === "start-filed-returns-flow") return { disabled: true, label: "Starting..." };
  if (busy !== null) return { disabled: true, label: defaultStartLabel(fullFiscalYear) };
  if (!context?.supported) return { disabled: true, label: "Open GST Portal tab first" };
  if (summary && isSameScope(scope, summary.scope)) {
    const signals = new Set(summary.flowStep.safeSignals);
    if (signals.has("filed-returns-run-active") || signals.has("full-fiscal-year-run-active")) {
      return { disabled: true, label: "Run in progress" };
    }
    if (signals.has("filed-returns-run-needs-review")) {
      return { disabled: true, label: "Reset stuck run first" };
    }
    if (
      signals.has("filed-returns-target-review-required") ||
      signals.has("full-fiscal-year-download-unconfirmed") ||
      signals.has("full-fiscal-year-run-interrupted") ||
      signals.has("full-fiscal-year-run-needs-action")
    ) {
      return { disabled: true, label: "Resolve current period first" };
    }
    if (signals.has("full-fiscal-year-resume-confirmation-required")) {
      return { disabled: true, label: "Resume or discard saved run" };
    }
  }
  return { disabled: false, label: defaultStartLabel(fullFiscalYear) };
}

function defaultStartLabel(fullFiscalYear: boolean): string {
  return fullFiscalYear ? "Start local full-year run" : "Start download";
}

function isSameScope(left: FiledReturnsDownloadScope, right: FiledReturnsDownloadScope): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType &&
    normaliseFiledReturnsArtifactType(left.returnType, left.artifactType) ===
      normaliseFiledReturnsArtifactType(right.returnType, right.artifactType)
  );
}
