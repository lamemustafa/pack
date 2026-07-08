import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalContext,
} from "../../core/contracts";
import {
  FILED_RETURNS_ARTIFACT_TYPES,
  filedReturnsArtifactLabel,
  concreteFiledReturnsArtifactTypes,
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
      description: artifactOptionDescription(scope.returnType, artifactType),
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
  return FILED_RETURNS_RETURN_TYPES.map((returnType) => {
    if (returnType === "GSTR-3B") {
      return {
        value: returnType,
        label: returnType,
        description: "Filed summary PDF",
      };
    }
    if (returnType === "GSTR-1") {
      return {
        value: returnType,
        label: returnType,
        description: "Summary plus e-invoice Excel",
      };
    }
    return {
      value: returnType,
      label: returnType,
      description: "ITC PDF and details workbook",
    };
  });
}

export function getSinglePeriodFallback(
  period: FiledReturnsDownloadScope["period"],
  options: Array<{ value: string; label: string }>,
): string {
  if (period !== FULL_FISCAL_YEAR_PERIOD) return period;
  return options[0]?.value ?? FILED_RETURNS_MONTHS[0];
}

export function getScopeActionCopy(
  scope: FiledReturnsDownloadScope,
  fullFiscalYear: boolean,
): { summary: string; details: string[] } {
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  const concreteArtifactCount = concreteFiledReturnsArtifactTypes(artifactType).length;
  if (!fullFiscalYear) {
    if (concreteArtifactCount > 1) {
      return {
        summary: "Collect the selected period into one local ZIP.",
        details: [
          "Stages PDF and Excel locally",
          "One browser handoff",
          "No portal data leaves the device",
        ],
      };
    }
    return {
      summary: "Collect one period from the active GST tab.",
      details: ["Target-bound click", "Local browser download", "No portal data leaves the device"],
    };
  }

  const details = [
    "Walks each eligible period",
    "Stages files locally",
    "Hands off one ZIP",
  ];

  if (scope.returnType === "GSTR-2B" && artifactType === "PDF_AND_EXCEL") {
    details.push("Captures only portal-generated PDF and Excel controls");
  }
  if (scope.returnType === "GSTR-1" && artifactType !== "PDF") {
    details.push("Includes Excel only when the portal provides it");
  }
  return {
    summary: "Collect eligible periods into one local ZIP.",
    details,
  };
}

export function getScopeFormStartAction(
  scope: FiledReturnsDownloadScope,
  summary: FiledReturnsFlowSummary | null | undefined,
  busy: string | null,
  fullFiscalYear: boolean,
  context: PortalContext | null,
): { disabled: boolean; label: string } {
  if (busy === "start-filed-returns-flow") return { disabled: true, label: "Starting..." };
  if (busy !== null) return { disabled: true, label: defaultStartLabel(scope, fullFiscalYear) };
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
  return { disabled: false, label: defaultStartLabel(scope, fullFiscalYear) };
}

function defaultStartLabel(scope: FiledReturnsDownloadScope, fullFiscalYear: boolean): string {
  if (fullFiscalYear) return "Start full-year ZIP";
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  return concreteFiledReturnsArtifactTypes(artifactType).length > 1
    ? "Start period ZIP"
    : "Download selected period";
}

function artifactOptionDescription(
  returnType: FiledReturnsDownloadScope["returnType"],
  artifactType: (typeof FILED_RETURNS_ARTIFACT_TYPES)[number],
): string {
  if (artifactType === "PDF_AND_EXCEL") return "Best for one ZIP handoff";
  if (artifactType === "EXCEL") {
    return returnType === "GSTR-2B" ? "Portal details workbook" : "Portal e-invoice workbook";
  }
  return returnType === "GSTR-3B" ? "Filed return copy" : "Portal summary PDF";
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
